/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const MDStore = require('./md_store').MDStore;
const js_utils = require('../../util/js_utils');
const map_utils = require('./map_utils');
const Semaphore = require('../../util/semaphore');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const KeysLock = require('../../util/keys_lock');


const replicate_block_sem = new Semaphore(config.IO_REPLICATE_CONCURRENCY);
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
    }

    run() {
        dbg.log1('MapBuilder.run:', 'batch start', this.chunk_ids.length, 'chunks');
        if (!this.chunk_ids.length) return;

        return builder_lock.surround_keys(_.map(this.chunk_ids, String),
            () => P.resolve()
            .then(() => this.reload_chunks(this.chunk_ids))
            .then(() => system_store.refresh())
            .then(() => P.join(
                MDStore.instance().load_blocks_for_chunks(this.chunks),
                MDStore.instance().load_parts_objects_for_chunks(this.chunks)
                .then(res => this.prepare_and_fix_chunks(res))
            ))
            .then(() => this.refresh_alloc())
            .then(() => this.analyze_chunks())
            .then(() => this.allocate_blocks())
            .then(() => this.replicate_blocks())
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
        objects = _.filter(objects, object => {
            const bucket = system_store.data.get_by_id(object.bucket);
            if (!bucket) dbg.error(`Object ${object._id} is holding an invalid bucket ${object.bucket}`);
            return Boolean(bucket);
        });
        const parts_by_chunk = _.groupBy(parts, 'chunk');
        const objects_by_id = _.keyBy(objects, '_id');
        return P.map(this.chunks, chunk => {
            // if other actions should be done to prepare a chunk for build, those actions should be added here
            const chunk_parts = parts_by_chunk[chunk._id];
            const chunk_objects = _.uniq(_.map(chunk_parts, part => objects_by_id[part.obj]));
            return P.resolve()
                .then(() => {
                    if (!chunk_parts.length) throw new Error('No valid parts are pointing to chunk', chunk._id);
                    if (!chunk_objects.length) throw new Error('No valid objects are pointing to chunk', chunk._id);
                })
                .then(() => this.populate_chunk_bucket(chunk, chunk_objects))
                .catch(err => {
                    dbg.error(`failed to prepare chunk ${chunk._id} for builder`, err);
                    chunk.had_errors = true;
                    this.had_errors = true;
                });
        });
    }

    populate_chunk_bucket(chunk, objects) {
        let bucket = system_store.data.get_by_id(chunk.bucket);
        const object_bucket_ids = mongo_utils.uniq_ids(objects, 'bucket');
        //const object_buckets = object_bucket_ids.map(object_id => system_store.data.get_by_id(object_id));
        if (!object_bucket_ids.length) {
            dbg.error(`Chunk ${chunk._id} is held by ${objects.length} invalid objects. The following objects have no valid bucket`, objects);
            throw new Error('Chunk held by invalid objects');
        }
        if (object_bucket_ids.length > 1) {
            dbg.error(`Chunk ${chunk._id} is held by objects from ${object_bucket_ids.length} different buckets`);
        }
        if (!bucket || !object_bucket_ids.find(id => String(id) === String(bucket._id))) {
            dbg.error('chunk', chunk._id, 'is holding an invalid bucket', chunk.bucket, 'fixing to', object_bucket_ids[0]);
            const bucket_id = object_bucket_ids[0]; // This is arbitrary, but there shouldn't be more than one in a healthy system
            bucket = system_store.data.get_by_id(bucket_id);
            if (bucket) {
                chunk.bucket = bucket;
                return MDStore.instance().update_chunk_by_id(chunk._id, { bucket: bucket_id });
            }
            throw new Error('Could not fix chunk bucket. No suitable bucket found');
        }
        chunk.bucket = bucket;
    }

    refresh_alloc() {
        const populated_chunks = _.filter(this.chunks, chunk => !chunk.had_errors);
        // uniq works here since the bucket objects are the same from the system store
        const buckets = _.map(_.uniqBy(populated_chunks, 'bucket._id'), chunk => chunk.bucket);
        return P.map(buckets, bucket => node_allocator.refresh_tiering_alloc(bucket.tiering));
    }

    analyze_chunks() {
        _.each(this.chunks, chunk => {
            if (chunk.had_errors) return;
            map_utils.set_chunk_frags_from_blocks(chunk, chunk.blocks);
            const tiering_pools_status = node_allocator.get_tiering_pools_status(chunk.bucket.tiering);
            chunk.status = map_utils.get_chunk_status(chunk, chunk.bucket.tiering, {
                tiering_pools_status: tiering_pools_status
            });
            // only delete blocks if the chunk is in good shape,
            // that is no allocations needed, and is accessible.
            if (chunk.status.accessible &&
                !chunk.status.allocations.length &&
                chunk.status.deletions.length) {
                this.delete_blocks = this.delete_blocks || [];
                js_utils.array_push_all(this.delete_blocks, chunk.status.deletions);
            }
        });
    }

    allocate_blocks() {
        _.each(this.chunks, chunk => {
            if (!chunk.status) return;
            const avoid_nodes = chunk.blocks.map(block => String(block.node._id));
            const allocated_hosts = chunk.blocks.map(block => block.node.host_id);
            _.each(chunk.status.allocations, alloc => {
                const f = alloc.fragment;
                // We send an additional flag in order to allocate
                // replicas of content tiering feature on the best read latency nodes
                const node = node_allocator.allocate_node(alloc.pools, avoid_nodes, allocated_hosts, {
                    special_replica: chunk.is_special
                });
                if (!node) {
                    // In case of special chunks replication we consider it opportunistic
                    // Which means that they will be replicated when there are enough nodes
                    // They do not need to fail the rebuilding process
                    if (alloc.special_replica) {
                        dbg.error('MapBuilder: special chunk no nodes for allocation');
                        return;
                    }

                    dbg.error('MapBuilder: no nodes for allocation');
                    chunk.had_errors = true;
                    this.had_errors = true;
                    return;
                }
                const block = _.pick(f,
                    'layer',
                    'layer_n',
                    'frag',
                    'size',
                    'digest_type',
                    'digest_b64');
                block._id = MDStore.instance().make_md_id();
                block.node = node; // keep the node ref, same when populated
                block.system = chunk.system;
                block.chunk = chunk;
                block.bucket = chunk.bucket._id;
                alloc.block = block;
                avoid_nodes.push(String(node._id));
                allocated_hosts.push(node.host_id);
            });
        });
    }

    replicate_blocks() {
        return P.all(_.map(this.chunks, chunk => {
            if (!chunk.status) return;
            return P.all(_.map(chunk.status.allocations, alloc => {
                const block = alloc.block;
                if (!block) {
                    // block that failed to allocate - skip replicate.
                    return;
                }

                const f = alloc.fragment;
                f.accessible_blocks = f.accessible_blocks ||
                    _.filter(f.blocks, b => map_utils.is_block_accessible(b));
                f.next_source = f.next_source || 0;
                const source_block = f.accessible_blocks[f.next_source];
                //if no accessible_blocks - skip replication
                if (!source_block) {
                    return;
                }
                f.next_source = (f.next_source + 1) % f.accessible_blocks.length;

                const target = map_utils.get_block_md(block);
                const source = map_utils.get_block_md(source_block);

                dbg.log1('MapBuilder.replicate_blocks: replicating to', target,
                    'from', source, 'chunk', chunk);
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
                        dbg.log1('MapBuilder.replicate_blocks: replicated block',
                            block._id, 'to', target.address, 'from', source.address);
                    }, err => {
                        dbg.error('MapBuilder.replicate_blocks: FAILED replicate block',
                            block._id, 'to', target.address, 'from', source.address,
                            err.stack || err);
                        chunk.had_errors = true;
                        this.had_errors = true;
                        // don't fail here yet to allow handling the successful blocks
                        // so just keep the error, and we will fail at the end of build_chunks
                    });
            }));
        }));
    }

    update_db() {
        const now = new Date();
        _.each(this.new_blocks, block => {
            block.node = mongo_utils.make_object_id(block.node._id);
            block.chunk = block.chunk._id;
        });
        const success_chunk_ids = mongo_utils.uniq_ids(
            _.reject(this.chunks, 'had_errors'), '_id');
        const failed_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, 'had_errors'), '_id');

        const unset_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.special_replica && !chunk.is_special), '_id');
        const set_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.is_special && chunk.is_special !== chunk.special_replica), '_id');

        dbg.log1('MapBuilder.update_db:',
            'chunks', this.chunks.length,
            'success_chunk_ids', success_chunk_ids.length,
            'failed_chunk_ids', failed_chunk_ids.length,
            'new_blocks', _.get(this, 'new_blocks.length', 0),
            'delete_blocks', _.get(this, 'delete_blocks.length', 0));

        return P.join(
            MDStore.instance().insert_blocks(this.new_blocks),
            MDStore.instance().update_blocks_by_ids(mongo_utils.uniq_ids(this.delete_blocks, '_id'), { deleted: now }),
            MDStore.instance().update_chunks_by_ids(set_special_chunk_ids, { special_replica: true }),
            MDStore.instance().update_chunks_by_ids(unset_special_chunk_ids, undefined, { special_replica: true }),
            map_deleter.delete_blocks_from_nodes(this.delete_blocks)
        );
    }
}

exports.MapBuilder = MapBuilder;
