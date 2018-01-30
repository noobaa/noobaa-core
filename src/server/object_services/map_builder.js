/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const ObjectIO = require('../../sdk/object_io');
const js_utils = require('../../util/js_utils');
const KeysLock = require('../../util/keys_lock');
const nb_native = require('../../util/nb_native');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
const mongo_utils = require('../../util/mongo_utils');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');

const builder_lock = new KeysLock();
const object_io = new ObjectIO();

// dbg.set_level(5);

/**
 *
 * MapBuilder
 *
 * process list of chunk in a batch, and for each one make sure they are well built,
 * meaning that their blocks are available, by creating new blocks and replicating
 * them from accessible blocks, and removing unneeded blocks.
 *
 */
class MapBuilder {

    constructor(chunk_ids) {
        this.chunk_ids = chunk_ids;
        this.objects_to_delete = [];
        this.chunks_to_delete = [];
    }

    run() {
        dbg.log1('MapBuilder.run:', 'batch start', this.chunk_ids);
        if (!this.chunk_ids.length) return;

        return builder_lock.surround_keys(_.map(this.chunk_ids, String),
            () => P.resolve()
            .then(() => this.reload_chunks(this.chunk_ids))
            .then(() => system_store.refresh())
            .then(() => P.join(
                MDStore.instance().load_parts_objects_for_chunks(this.chunks),
                MDStore.instance().load_blocks_for_chunks(this.chunks)
            ))
            .spread(parts_objects_res => this.prepare_and_fix_chunks(parts_objects_res))
            .then(() => this.refresh_alloc())
            .then(() => this.build_chunks())
            .then(() => this.update_db())
            .then(() => {
                // return error from the promise if any replication failed,
                // so that caller will know the build isn't really complete,
                // although it might partially succeeded
                if (this.had_errors) {
                    throw new Error('MapBuilder had errors');
                }
            }));
    }


    // In order to get the most relevant data regarding the chunks
    // Note that there is always a possibility that the chunks will cease to exist
    reload_chunks(chunk_ids) {
        return P.resolve()
            .then(() => MDStore.instance().find_chunks_by_ids(chunk_ids))
            .then(chunks => {
                this.chunks = chunks;
                dbg.log1('MapBuilder.reload_chunks:', this.chunks);
            });
    }

    prepare_and_fix_chunks({ parts, objects }) {
        // first look for deleted chunks, and set it's blocks for deletion
        const [deleted_chunks, live_chunks] = _.partition(this.chunks, chunk => chunk.deleted);
        // set this.chunks to only hold live chunks
        this.chunks = live_chunks;

        // mark all live blocks of deleted chunks for deletion
        _.each(deleted_chunks, chunk => {
            const live_blocks = chunk.blocks.filter(block => !block.deleted);
            if (live_blocks.length) {
                dbg.log0('identified undeleted blocks of a deleted chunk. chunk =', chunk._id, 'blocks =', live_blocks);
                this.delete_blocks = this.delete_blocks || [];
                js_utils.array_push_all(this.delete_blocks, live_blocks);
            }
        });
        const parts_by_chunk = _.groupBy(parts, 'chunk');
        const objects_by_id = _.keyBy(objects, '_id');
        return P.map(this.chunks, chunk => {
            // if other actions should be done to prepare a chunk for build, those actions should be added here
            chunk.chunk_coder_config = system_store.data.get_by_id(chunk.chunk_config).chunk_coder_config;
            chunk.parts = parts_by_chunk[chunk._id];
            chunk.objects = _.uniq(_.compact(_.map(chunk.parts, part => objects_by_id[part.obj])));
            return P.resolve()
                .then(() => {
                    if (!chunk.parts || !chunk.parts.length) throw new Error('No valid parts are pointing to chunk', chunk._id);
                    if (!chunk.objects || !chunk.objects.length) throw new Error('No valid objects are pointing to chunk', chunk._id);
                })
                .then(() => this.clean_up_undeleted_chunks_and_blocks(chunk))
                .then(() => this.populate_chunk_bucket(chunk))
                .catch(err => {
                    dbg.error(`failed to prepare chunk ${chunk._id} for builder`, err);
                    chunk.had_errors = true;
                    this.had_errors = true;
                });
        });
    }

    clean_up_undeleted_chunks_and_blocks(chunk) {
        return P.resolve()
            .then(() => {
                const no_valid_parts = _.every(chunk.parts, part => Boolean(part.deleted));
                if (no_valid_parts) {
                    dbg.warn(`Chunk marked for deletion ${chunk._id}`);
                    this.chunks_to_delete.push(chunk);
                }
            });
    }

    populate_chunk_bucket(chunk) {
        let bucket = system_store.data.get_by_id(chunk.bucket);
        const object_bucket_ids = mongo_utils.uniq_ids(chunk.objects, 'bucket');
        const valid_buckets = _.compact(object_bucket_ids.map(bucket_id => system_store.data.get_by_id(bucket_id)));
        if (!valid_buckets.length) {
            return system_store.data.get_by_id_include_deleted(chunk.bucket, 'buckets')
                .then(deleted_bucket => {
                    if (deleted_bucket) {
                        dbg.warn(`Chunk ${chunk._id} is held by a deleted bucket ${deleted_bucket.name} marking for deletion`);
                        chunk.bucket = deleted_bucket.record;
                        this.objects_to_delete.push(_.filter(chunk.objects, obj => _.isEqual(obj.bucket, deleted_bucket.record._id)));
                        return;
                    }
                    //We prefer to leave the option for manual fix if we'll need it
                    dbg.error(`Chunk ${chunk._id} is held by ${chunk.objects.length} invalid objects. The following objects have no valid bucket`, chunk.objects);
                    throw new Error('Chunk held by invalid objects');
                });
        }
        if (valid_buckets.length > 1) {
            dbg.error(`Chunk ${chunk._id} is held by objects from ${object_bucket_ids.length} different buckets`);
        }
        if (!bucket || !object_bucket_ids.find(id => String(id) === String(bucket._id))) {
            dbg.error('chunk', chunk._id, 'is holding an invalid bucket', chunk.bucket, 'fixing to', valid_buckets[0]);
            bucket = valid_buckets[0]; // This is arbitrary, but there shouldn't be more than one in a healthy system
            if (bucket) {
                chunk.bucket = bucket;
                return MDStore.instance().update_chunk_by_id(chunk._id, { bucket: bucket._id });
            }
            throw new Error('Could not fix chunk bucket. No suitable bucket found');
        }
        chunk.bucket = bucket;
    }

    refresh_alloc() {
        const populated_chunks = _.filter(this.chunks, chunk => !chunk.had_errors && !chunk.bucket.deleted);
        // uniq works here since the bucket objects are the same from the system store
        const buckets = _.uniqBy(_.map(populated_chunks, chunk => chunk.bucket), '_id');
        return P.map(buckets, bucket => node_allocator.refresh_tiering_alloc(bucket.tiering));
    }

    build_chunks() {
        return P.map(this.chunks, chunk => {
            dbg.log2('MapBuilder.build_chunks: chunk', chunk);

            if (chunk.had_errors || chunk.bucket.deleted) return;

            const tiering_status = node_allocator.get_tiering_status(chunk.bucket.tiering);
            const mapping = mapper.map_chunk(chunk, chunk.bucket.tiering, tiering_status);
            dbg.log2('MapBuilder.build_chunks: mapping', mapping);

            // only delete blocks if the chunk is in good shape,
            // that is no allocations needed, and is accessible.
            if (mapping.accessible && !mapping.allocations && mapping.deletions) {
                this.delete_blocks = this.delete_blocks || [];
                js_utils.array_push_all(this.delete_blocks, mapping.deletions);
            }

            // first allocate the basic allocations of the chunk.
            // if there are no allocations, then try to allocate extra_allocations for special replicas
            const current_cycle_allocations = mapping.allocations || mapping.extra_allocations;
            if (!current_cycle_allocations) return;
            if (mapping.allocations) {
                dbg.log0('MapBuilder.build_chunks: allocations needed for chunk',
                    chunk, _.map(chunk.objects, 'key'));
            }

            const avoid_blocks = chunk.blocks.filter(block => block.node.node_type === 'BLOCK_STORE_FS');
            chunk.avoid_nodes = avoid_blocks.map(block => String(block.node._id));
            chunk.allocated_hosts = avoid_blocks.map(block => block.node.host_id);
            chunk.rpc_client = server_rpc.rpc.new_client({
                auth_token: auth_server.make_auth_token({
                    system_id: chunk.system,
                    role: 'admin',
                })
            });
            chunk[util.inspect.custom] = custom_inspect_chunk;

            return P.resolve()
                .then(() => mapping.missing_frags && this.read_entire_chunk(chunk))
                .then(chunk_info => P.map(current_cycle_allocations,
                    alloc => this.build_block(chunk, chunk_info, alloc)
                ));
        });
    }

    build_block(chunk, chunk_info, alloc) {
        const { sources, special_replica } = alloc;
        return P.resolve()
            .then(() => {
                if (sources) {
                    return this.build_block_from_replicas(chunk, chunk_info, alloc);
                }
                if (chunk_info) {
                    return this.build_block_from_frags(chunk, chunk_info, alloc);
                }
                dbg.error('MapBuilder.build_block: No sources', alloc);
                throw new Error('MapBuilder.build_block: No sources');
            })
            .then(block => {
                this.new_blocks = this.new_blocks || [];
                this.new_blocks.push(block);
                dbg.log0('MapBuilder.build_block: built new block', block._id, 'to', block.node.rpc_address);
            })
            .catch(err => {
                // don't fail here yet to allow handling the successful blocks
                // so just keep the error, and we will fail at the end of MapBuilder.run()
                // however for special replicas we don't fail, since it is opportunistic
                if (special_replica) {
                    dbg.warn('MapBuilder.build_block: special_replica FAILED', alloc, err.stack || err);
                } else {
                    dbg.error('MapBuilder.build_block: FAILED', alloc, err.stack || err);
                    chunk.had_errors = true;
                    this.had_errors = true;
                }
            });
    }

    build_block_from_replicas(chunk, chunk_info, alloc) {
        const { frag, sources } = alloc;

        const source_block = sources.accessible_blocks[sources.next_source];
        sources.next_source = (sources.next_source + 1) % sources.accessible_blocks.length;

        const block = this.allocate_block(chunk, alloc);
        const target = mapper.get_block_md(chunk, frag, block);
        const source = mapper.get_block_md(chunk, frag, source_block);

        const params = { client: chunk.rpc_client };
        const desc = { chunk: chunk._id, frag };

        dbg.log0('MapBuilder.build_block_from_replicas: replicating to', target, 'from', source, 'chunk', chunk);
        return P.resolve()
            .then(() => object_io._replicate_block(params, source, target, desc))
            .then(() => block);
    }

    build_block_from_frags(chunk, chunk_info, alloc) {
        const { frag } = alloc;
        const block = this.allocate_block(chunk, alloc);
        const target = mapper.get_block_md(chunk, frag, block);
        const frag_with_data = _.find(chunk_info.frags, _.matches(_.pick(frag, 'data_index', 'parity_index', 'lrc_index')));
        dbg.log0('MapBuilder.build_block_from_frags: target', target, 'frag', frag, 'frag_with_data', frag_with_data);
        const desc = { chunk: chunk._id, frag };
        const params = {
            client: chunk.rpc_client,
            bucket: chunk.bucket.name,
            key: '', // faking it as we don't want to read and obj just for that
        };
        return P.resolve()
            .then(() => object_io._write_block(params, frag_with_data.block, target, desc))
            .then(() => block);
    }

    read_entire_chunk(chunk) {
        const part_candidate = _.clone(chunk.parts[0]);
        part_candidate.chunk = chunk;
        const part = mapper.get_part_info(part_candidate);
        part.desc = { chunk: chunk._id };
        const chunk_info = part.chunk;
        const params = {
            client: chunk.rpc_client,
            bucket: chunk.bucket.name,
            key: '', // faking it as we don't want to read and obj just for that
        };
        dbg.log0('MapBuilder.read_entire_chunk: chunk before reading', chunk_info);
        return P.resolve()
            .then(() => object_io._read_frags(params, part, chunk_info.frags))
            .catch(err => {
                console.log('MapBuilder.read_entire_chunk: _read_frags ERROR', err);
                throw err;
            })
            .then(() => {
                dbg.log0('MapBuilder.read_entire_chunk: chunk before encoding', chunk_info);
                chunk_info.coder = 'enc';
                return P.fromCallback(cb => nb_native().chunk_coder(chunk_info, cb));
            })
            .then(() => {
                dbg.log0('MapBuilder.read_entire_chunk: final chunk', chunk_info);
                return chunk_info;
            });
    }

    allocate_block(chunk, alloc) {
        const { avoid_nodes, allocated_hosts } = chunk;
        const { frag, pools, special_replica } = alloc;
        const block_id = MDStore.instance().make_md_id();

        // We send an additional flag in order to allocate
        // replicas of content tiering feature on the best read latency nodes
        const node = node_allocator.allocate_node(
            pools, avoid_nodes, allocated_hosts, { special_replica }
        );

        if (!node) throw new Error(`MapBuilder.allocate_block: no nodes for allocation. block ${block_id} chunk ${chunk._id} frag ${util.inspect(frag)}`);

        dbg.log0('MapBuilder.allocate_block: block', block_id,
            'node', node._id, node.name, 'chunk', chunk._id, 'frag', frag);

        const block = {
            _id: block_id,
            chunk,
            frag: frag._id,
            size: chunk.frag_size,
            system: chunk.system,
            bucket: chunk.bucket._id,
        };
        mapper.assign_node_to_block(block, node, chunk.system);
        if (node.node_type === 'BLOCK_STORE_FS') {
            avoid_nodes.push(String(node._id));
            allocated_hosts.push(node.host_id);
        }
        return block;
    }

    update_db() {
        const now = new Date();
        _.each(this.new_blocks, block => {
            const bucket = block.chunk.bucket;
            const block_id_time = block._id.getTimestamp().getTime();
            if (block_id_time < now.getTime() - (config.MD_GRACE_IN_MILLISECONDS - config.MD_AGGREGATOR_INTERVAL)) {
                dbg.error('MapBuilder.update_db: A big gap was found between id creation and addition to DB:',
                    block, bucket.name, block_id_time, now.getTime());
            }
            if (block_id_time < bucket.storage_stats.last_update + config.MD_AGGREGATOR_INTERVAL) {
                dbg.error('MapBuilder.update_db: A big gap was found between id creation and bucket last update:',
                    block, bucket.name, block_id_time, bucket.storage_stats.last_update);
            }
            block.node = mongo_utils.make_object_id(block.node._id);
            block.chunk = block.chunk._id;
        });
        const success_chunk_ids = mongo_utils.uniq_ids(
            _.reject(this.chunks, chunk => chunk.had_errors || chunk.bucket.deleted), '_id');
        const failed_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.had_errors && !chunk.bucket.deleted), '_id');
        const objs_to_be_deleted = _.uniqBy(_.flatten(this.objects_to_delete), '_id');
        const chunks_to_be_deleted = _.uniqBy(_.flatten(this.chunks_to_delete), '_id');

        const unset_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.special_replica && !chunk.is_special), '_id');
        const set_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.is_special && chunk.is_special !== chunk.special_replica), '_id');

        dbg.log1('MapBuilder.update_db:',
            'chunks', this.chunks.length,
            'success_chunk_ids', success_chunk_ids.length,
            'failed_chunk_ids', failed_chunk_ids.length,
            'objs_to_be_deleted', objs_to_be_deleted.length,
            'chunks_to_be_deleted', chunks_to_be_deleted.length,
            'new_blocks', _.get(this, 'new_blocks.length', 0),
            'delete_blocks', _.get(this, 'delete_blocks.length', 0));

        return P.join(
            MDStore.instance().insert_blocks(this.new_blocks),
            MDStore.instance().update_blocks_by_ids(mongo_utils.uniq_ids(this.delete_blocks, '_id'), { deleted: now }),
            MDStore.instance().update_chunks_by_ids(set_special_chunk_ids, { special_replica: true }),
            MDStore.instance().update_chunks_by_ids(unset_special_chunk_ids, undefined, { special_replica: true }),
            map_deleter.delete_blocks_from_nodes(this.delete_blocks),
            map_deleter.delete_multiple_objects(objs_to_be_deleted)
            .each(res => {
                if (!res.isFulfilled()) {
                    dbg.log0('Failed delete_multiple_objects', res);
                }
            }),
            map_deleter.delete_chunks(_.map(chunks_to_be_deleted, '_id'))
        );
    }
}

/**
 * avoid printing rpc_client to logs, it's ugly
 * also avoid infinite recursion and omit inspect function
 * @this chunk
 */
function custom_inspect_chunk() {
    return _.omit(this, 'rpc_client', util.inspect.custom);
}

exports.MapBuilder = MapBuilder;
