/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const js_utils = require('../../util/js_utils');
const Semaphore = require('../../util/semaphore');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const KeysLock = require('../../util/keys_lock');


const replicate_block_sem = new Semaphore(config.IO_REPLICATE_CONCURRENCY_GLOBAL);
const builder_lock = new KeysLock();

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
        dbg.log1('MapBuilder.run:', 'batch start', this.chunk_ids.length, 'chunks');
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
            dbg.log2('MapBuilder.build_chunks:', chunk);

            if (chunk.had_errors || chunk.bucket.deleted) return;

            const tiering_status = node_allocator.get_tiering_status(chunk.bucket.tiering);
            const mapping = mapper.map_chunk(chunk, chunk.bucket.tiering, tiering_status);

            // first allocate the basic allocations of the chunk.
            // if there are no allocations, then try to allocate extra_allocations for special replicas
            const current_cycle_allocations = mapping.allocations || mapping.extra_allocations;

            // only delete blocks if the chunk is in good shape,
            // that is no allocations needed, and is accessible.
            if (mapping.accessible && !mapping.allocations && mapping.deletions) {
                this.delete_blocks = this.delete_blocks || [];
                js_utils.array_push_all(this.delete_blocks, mapping.deletions);
            }

            const avoid_nodes = chunk.blocks.map(block => String(block.node._id));
            const allocated_hosts = chunk.blocks.map(block => block.node.host_id);

            if (!current_cycle_allocations) return;

            _.each(current_cycle_allocations, alloc => {
                const { frag, pools, special_replica } = alloc;
                dbg.log2('MapBuilder.build_chunks:', chunk._id, 'frag', frag);
                // We send an additional flag in order to allocate
                // replicas of content tiering feature on the best read latency nodes
                const node = node_allocator.allocate_node(
                    pools, avoid_nodes, allocated_hosts, { special_replica });
                if (!node) {
                    // In case of special chunks replication we consider it opportunistic
                    // Which means that they will be replicated when there are enough nodes
                    // They do not need to fail the rebuilding process
                    if (special_replica) {
                        dbg.error('MapBuilder: special chunk no nodes for allocation');
                        return;
                    }

                    dbg.error('MapBuilder: no nodes for allocation');
                    chunk.had_errors = true;
                    this.had_errors = true;
                    return;
                }
                const block = {
                    _id: MDStore.instance().make_md_id(),
                    chunk,
                    frag: frag._id,
                    size: chunk.frag_size,
                    system: chunk.system,
                    bucket: chunk.bucket._id,
                };
                mapper.assign_node_to_block(block, node, chunk.system);
                alloc.block = block;
                avoid_nodes.push(String(node._id));
                allocated_hosts.push(node.host_id);
            });

            return P.map(current_cycle_allocations, alloc => {
                const { frag, block, sources } = alloc;
                dbg.log2('MapBuilder.build_chunks:', chunk._id, 'frag', frag);

                // block that failed to allocate - skip replicate.
                if (!block) return;

                const source_block = sources.accessible_blocks[sources.next_source];

                // TODO GUY GAP rebuild chunk from erasure codes

                // if no accessible_blocks - skip replication
                if (!source_block) return;
                sources.next_source = (sources.next_source + 1) % sources.accessible_blocks.length;

                const target = mapper.get_block_md(chunk, frag, block);
                const source = mapper.get_block_md(chunk, frag, source_block);

                dbg.log1('MapBuilder: replicating to', target, 'from', source, 'chunk', chunk);
                return replicate_block_sem.surround(
                        () => server_rpc.client.block_store.replicate_block({
                            target: target,
                            source: source
                        }, {
                            address: target.address,
                        })
                    )
                    .then(() => {
                        this.new_blocks = this.new_blocks || [];
                        this.new_blocks.push(block);
                        dbg.log1('MapBuilder: replicated block',
                            block._id, 'to', target.address, 'from', source.address);
                    }, err => {
                        dbg.error('MapBuilder: FAILED replicate block',
                            block._id, 'to', target.address, 'from', source.address,
                            err.stack || err);
                        chunk.had_errors = true;
                        this.had_errors = true;
                        // don't fail here yet to allow handling the successful blocks
                        // so just keep the error, and we will fail at the end of MapBuilder.run()
                    });
            });
        });
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

exports.MapBuilder = MapBuilder;
