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
const system_utils = require('../utils/system_utils');
const size_utils = require('../../util/size_utils');

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


    async run(chunk_ids, tier) {
        this.tier = tier;
        dbg.log0('MapBuilder.run:', 'batch start', chunk_ids);
        if (!chunk_ids.length) return;

        await builder_lock.surround_keys(_.map(chunk_ids, String), async () => {

            // we run the build twice. first time to perform all allocation, second time to perform deletions
            await this.run_build(chunk_ids);
            // run build a second time on the allocated chunks
            await this.run_build(this.allocated_chunk_ids);

            // return error from the promise if any replication failed,
            // so that caller will know the build isn't really complete,
            // although it might partially succeeded
            if (this.had_errors) {
                throw new Error('MapBuilder had errors');
            }

        });
    }



    async run_build(chunk_ids) {
        if (!chunk_ids.length) return;

        // this.had_errors is intentially not reset to keep errors between calls to run_build
        this.chunks = [];
        this.objects_to_delete = [];
        this.chunks_to_delete = [];
        this.allocated_chunk_ids = [];
        this.new_blocks = [];
        this.delete_blocks = [];


        await this.reload_chunks(chunk_ids);
        await system_store.refresh();
        const [parts_objects_res, ] = await P.all([
            MDStore.instance().load_parts_objects_for_chunks(this.chunks),
            MDStore.instance().load_blocks_for_chunks(this.chunks)
        ]);
        await this.prepare_and_fix_chunks(parts_objects_res);

        await this.refresh_alloc();
        await this.build_chunks();
        await this.update_db();
    }

    // In order to get the most relevant data regarding the chunks
    // Note that there is always a possibility that the chunks will cease to exist
    // TODO: We can release the unrelevant chunks from the surround_keys
    // This will allow other batches to run if they wait on non existing chunks
    reload_chunks(chunk_ids) {
        return P.resolve()
            .then(() => MDStore.instance().find_chunks_by_ids(chunk_ids))
            .then(chunks => {
                this.chunks = chunks;
                dbg.log1('MapBuilder.reload_chunks:', this.chunks);
            });
    }

    async prepare_and_fix_chunks({ parts, objects }) {
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
        await P.map(this.chunks, async chunk => {
            // if other actions should be done to prepare a chunk for build, those actions should be added here
            chunk.parts = parts_by_chunk[chunk._id];
            chunk.objects = _.uniq(_.compact(_.map(chunk.parts, part => objects_by_id[part.obj])));
            system_utils.prepare_chunk_for_mapping(chunk);

            try {
                if (!chunk.parts || !chunk.parts.length) throw new Error('No valid parts are pointing to chunk', chunk._id);
                if (!chunk.objects || !chunk.objects.length) throw new Error('No valid objects are pointing to chunk', chunk._id);

                await this.populate_chunk_bucket(chunk);
                if (!chunk.tier._id) { // tier was deleted?
                    const tiering_status = node_allocator.get_tiering_status(chunk.bucket.tiering);
                    chunk.tier = mapper.select_tier_for_write(chunk.bucket.tiering, tiering_status);
                }
            } catch (err) {
                dbg.error(`failed to prepare chunk ${chunk._id} for builder`, err);
                chunk.had_errors = true;
                this.had_errors = true;
            }
        });

        // do not build chunk that all of its parts are deleted. mark them for deletion
        const [chunks_to_delete, chunks_to_build] = _.partition(this.chunks,
            chunk => _.every(chunk.parts, part => Boolean(part.deleted)));
        this.chunks_to_delete = chunks_to_delete;
        if (this.chunks_to_delete.length) {
            dbg.warn(`Chunks marked for deletion:`, this.chunks_to_delete);
        }
        this.chunks = chunks_to_build;
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

    async refresh_alloc() {
        const populated_chunks = _.filter(this.chunks, chunk => !chunk.had_errors && !chunk.bucket.deleted);
        // uniq works here since the bucket objects are the same from the system store
        const buckets = _.uniqBy(_.map(populated_chunks, chunk => chunk.bucket), '_id');
        await P.map(buckets, bucket => node_allocator.refresh_tiering_alloc(bucket.tiering));

        let chunks_moving_tiers = 0;
        if (this.tier) {
            if (buckets.length > 1) {
                throw new Error(`Not all chunks belong to the same bucket`);
            }
            const bucket = buckets[0];
            chunks_moving_tiers = await make_room_in_tier(this.tier, bucket, config.MIN_TIER_FREE_THRESHOLD); /* TODO JACKY free_threshold ??? */
        } else {
            for (const chunk of populated_chunks) {
                chunks_moving_tiers += await make_room_in_tier(chunk.tier, chunk.bucket, config.MIN_TIER_FREE_THRESHOLD);
            }
        }
        // We always call refresh_tiering_alloc twice, but if make_room_in_tier doesn't do anything we can skip it
        return await chunks_moving_tiers && P.map(buckets, bucket => node_allocator.refresh_tiering_alloc(bucket.tiering));
    }

    build_chunks() {
        return P.map(this.chunks, chunk =>
            P.resolve()
            .then(() => this.build_chunk(chunk))
            .catch(err => {
                // we make sure to catch and continue here since we process a batch
                // of chunks concurrently, and if any one of these chunks fails
                // we still need to call update_db() for all the blocks that succeeded
                // to be inserted in the DB, otherwise we will leak these blocks on the nodes.
                dbg.error('MapBuilder.build_chunks: FAILED', chunk, err.stack || err);
                chunk.had_errors = true;
                this.had_errors = true;
            })
        );
    }

    async build_chunk(chunk) {
        dbg.log2('MapBuilder.build_chunks: chunk', chunk);

        if (chunk.had_errors || chunk.bucket.deleted) return;

        const tiering_status = node_allocator.get_tiering_status(chunk.bucket.tiering);
        const selected_tier = this.tier || chunk.tier;
        const mapping = mapper.map_chunk(chunk, selected_tier, chunk.bucket.tiering, tiering_status);
        dbg.log2('MapBuilder.build_chunks: mapping', chunk._id, util.inspect(mapping, { depth: null, colors: true }));

        // only delete blocks if the chunk is in good shape,
        // that is no allocations needed, and is accessible.
        if (mapping.accessible && !mapping.allocations && mapping.deletions) {
            dbg.log0('MapBuilder.build_chunks: print mapping on deletions', mapping);
            js_utils.array_push_all(this.delete_blocks, mapping.deletions);
        }

        if (!mapping.allocations) return;

        dbg.log0('MapBuilder.build_chunks: allocations needed for chunk',
            chunk, _.map(chunk.objects, 'key'));

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

        const chunk_info = mapping.missing_frags && await this.read_entire_chunk(chunk);
        await P.map(mapping.allocations, alloc => this.build_block(chunk, chunk_info, alloc));
        if (!chunk.had_errors) {
            this.allocated_chunk_ids.push(chunk._id);
        }

    }

    build_block(chunk, chunk_info, alloc) {
        const { sources } = alloc;
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
                this.new_blocks.push(block);
                dbg.log0('MapBuilder.build_block: built new block', block._id, 'to', block.node.rpc_address);
            })
            .catch(err => {
                // don't fail here yet to allow handling the successful blocks
                // so just keep the error, and we will fail at the end of MapBuilder.run()
                dbg.error('MapBuilder.build_block: FAILED', alloc, err.stack || err);
                chunk.had_errors = true;
                this.had_errors = true;
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
        const { frag, pools } = alloc;
        const block_id = MDStore.instance().make_md_id();

        // We send an additional flag in order to allocate
        // replicas of content tiering feature on the best read latency nodes
        const node = node_allocator.allocate_node(
            pools, avoid_nodes, allocated_hosts
        );

        if (!node) {
            dbg.log0('MapBuilder.allocate_block: no nodes for allocation', block_id, 'chunk', chunk._id, 'frag', frag);
            throw new Error('MapBuilder.allocate_block: no nodes for allocation');
        }

        dbg.log0('MapBuilder.allocate_block: block', block_id, 'node', node._id, node.name, 'chunk', chunk._id, 'frag', frag);

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
            map_deleter.builder_delete_blocks(this.delete_blocks),
            // We do not care about the latest flags for objects that do not have a bucket
            P.map(objs_to_be_deleted, obj => MDStore.instance().remove_object_and_unset_latest(obj)
                .then(() => map_deleter.delete_object_mappings(obj))
                .catch(err => dbg.error('Failed to delete object', obj, 'with error', err))
            ),
            map_deleter.delete_chunks(_.map(chunks_to_be_deleted, '_id')),
            this.tier && MDStore.instance().update_chunks_by_ids(success_chunk_ids, { tier: this.tier._id }),
        );
    }
}

async function make_room_in_tier(tier, bucket, free_threshold) {
    const tiering = bucket.tiering;
    const tiering_status = node_allocator.get_tiering_status(tiering);
    const tier_status = tiering_status[tier._id];
    const tier_in_tiering = _.find(tiering.tiers, t => String(t.tier._id) === String(tier._id));
    if (!tier_in_tiering || !tier_status) throw new Error(`Can't find current tier in bucket`);
    const available_to_upload = size_utils.json_to_bigint(size_utils.reduce_maximum(
        'free', tier_status.mirrors_storage.map(storage => (storage.free || 0))
    ));
    if (available_to_upload && available_to_upload.greater(free_threshold)) return 0;
    const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids(tier._id, config.CHUNK_MOVE_LIMIT, 1);
    // const next_tier = _.find(tiering.tiers, t => t.order === (tier_in_tiering.order + 1));
    const next_tier = mapper.select_tier_for_write(tiering, tiering_status, tier._id);
    if (!next_tier) {
        console.log(`Can't make room in tier - No next tier to move data to`, tier.name);
        return 0;
    }
    console.log(`Making room in tier ${tier.name} - Moving ${chunk_ids.length} to next tier ${next_tier.name}`);
    await server_rpc.client.scrubber.build_chunks({
        chunk_ids,
        tier: next_tier._id,
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: bucket.system._id,
            role: 'admin'
        })
    });
    return chunk_ids.length;
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
exports.make_room_in_tier = make_room_in_tier;
