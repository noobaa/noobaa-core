'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const md_store = require('./md_store');
const js_utils = require('../../util/js_utils');
const map_utils = require('./map_utils');
const Semaphore = require('../../util/semaphore');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const system_server_utils = require('../utils/system_server_utils');
// const promise_utils = require('../../util/promise_utils');


const replicate_block_sem = new Semaphore(config.REPLICATE_CONCURRENCY);


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

    constructor(chunks) {
        this.chunks = chunks;
        this.system_id = chunks[0] && chunks[0].system;
    }

    run() {
        dbg.log1('MapBuilder.run:', 'batch start', this.chunks.length, 'chunks');
        if (!this.chunks.length) return;
        if (system_server_utils.system_in_maintenance(this.system_id)) return;
        return P.resolve()
            .then(() => P.join(
                system_store.refresh(),
                md_store.load_blocks_for_chunks(this.chunks),
                md_store.load_parts_objects_for_chunks(this.chunks),
                this.mark_building()
            ))
            .then(() => this.analyze_chunks())
            .then(() => this.refresh_alloc())
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
            });
    }


    // update the chunks to building mode
    mark_building() {
        let chunks_need_update_to_building = _.reject(this.chunks, 'building');
        return chunks_need_update_to_building.length &&
            P.resolve(md_store.DataChunk.collection.updateMany({
                _id: {
                    $in: _.map(chunks_need_update_to_building, '_id')
                }
            }, {
                $set: {
                    building: new Date(),
                }
            }));
    }

    analyze_chunks() {
        _.each(this.chunks, chunk => {
            let bucket = system_store.data.get_by_id(chunk.bucket);
            map_utils.set_chunk_frags_from_blocks(chunk, chunk.blocks);
            chunk.status = map_utils.get_chunk_status(chunk, bucket.tiering, /*async_mirror=*/ false);
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

    refresh_alloc() {
        let bucket_ids = mongo_utils.uniq_ids(this.chunks, 'bucket');
        let buckets = _.map(bucket_ids, id => system_store.data.get_by_id(id));
        return P.map(buckets,
            bucket => node_allocator.refresh_tiering_alloc(bucket.tiering)
        );
    }

    allocate_blocks() {
        _.each(this.chunks, chunk => {
            let avoid_nodes = _.map(chunk.blocks, block => String(block.node._id));
            _.each(chunk.status.allocations, alloc => {
                let f = alloc.fragment;
                let block = _.pick(f,
                    'layer',
                    'layer_n',
                    'frag',
                    'size',
                    'digest_type',
                    'digest_b64');
                block._id = md_store.make_md_id();
                // We send an additional flag in order to allocate
                // replicas of content tiering feature on the best read latency nodes
                let node = node_allocator.allocate_node(alloc.pools, avoid_nodes, {
                    special_replica: true
                });
                if (!node) {
                    dbg.error('MapBuilder: no nodes for allocation');
                    chunk.had_errors = true;
                    this.had_errors = true;
                    return;
                }
                block.node = node; // keep the node ref, same when populated
                block.system = chunk.system;
                block.chunk = chunk;
                alloc.block = block;
                avoid_nodes.push(String(node._id));
            });
        });
    }

    replicate_blocks() {
        return P.all(_.map(this.chunks, chunk => {
            return P.all(_.map(chunk.status.allocations, alloc => {
                let block = alloc.block;
                if (!block) {
                    // block that failed to allocate - skip replicate.
                    return;
                }

                let f = alloc.fragment;
                f.accessible_blocks = f.accessible_blocks ||
                    _.filter(f.blocks, b => map_utils.is_block_accessible(b));
                f.next_source = f.next_source || 0;
                let source_block = f.accessible_blocks[f.next_source];
                //if no accessible_blocks - skip replication
                if (!source_block) {
                    return;
                }
                f.next_source = (f.next_source + 1) % f.accessible_blocks.length;

                let target = map_utils.get_block_md(block);
                let source = map_utils.get_block_md(source_block);

                dbg.log1('MapBuilder.replicate_blocks: replicating to', target,
                    'from', source, 'chunk', chunk);
                return replicate_block_sem.surround(() => {
                    return server_rpc.client.block_store.replicate_block({
                        target: target,
                        source: source
                    }, {
                        address: target.address,
                    });
                }).then(() => {
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
        _.each(this.new_blocks, block => {
            block.node = mongo_utils.make_object_id(block.node._id);
            block.chunk = block.chunk._id;
        });
        let success_chunk_ids = mongo_utils.uniq_ids(
            _.reject(this.chunks, 'had_errors'), '_id');
        let failed_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, 'had_errors'), '_id');

        let unset_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.special_replica && !chunk.is_special), '_id');
        let set_special_chunk_ids = mongo_utils.uniq_ids(
            _.filter(this.chunks, chunk => chunk.is_special && chunk.is_special !== chunk.special_replica), '_id');

        dbg.log1('MapBuilder.update_db:',
            'chunks', this.chunks.length,
            'success_chunk_ids', success_chunk_ids.length,
            'failed_chunk_ids', failed_chunk_ids.length,
            'new_blocks', this.new_blocks && this.new_blocks.length || 0,
            'delete_blocks', this.delete_blocks && this.delete_blocks.length || 0);

        return P.join(
            this.new_blocks && this.new_blocks.length &&
            P.resolve(md_store.DataBlock.collection.insertMany(this.new_blocks)),

            this.delete_blocks && this.delete_blocks.length &&
            P.resolve(md_store.DataBlock.collection.updateMany({
                _id: {
                    $in: mongo_utils.uniq_ids(this.delete_blocks, '_id')
                }
            }, {
                $set: {
                    deleted: new Date()
                }
            })),

            //delete actual blocks from agents.
            this.delete_blocks && this.delete_blocks.length &&
            P.resolve().then(() => {
                //TODO: If the overload of these calls is too big, we should protect
                //ourselves in a similar manner to the replication
                var blocks_by_node = _.groupBy(this.delete_blocks,
                    block => String(block.node._id));
                return P.all(_.map(blocks_by_node, map_deleter.agent_delete_call));
            }),

            success_chunk_ids.length &&
            md_store.DataChunk.collection.updateMany({
                _id: {
                    $in: success_chunk_ids
                }
            }, {
                $set: {
                    last_build: new Date(),
                },
                $unset: {
                    building: true
                }
            }),

            failed_chunk_ids.length &&
            md_store.DataChunk.collection.updateMany({
                _id: {
                    $in: failed_chunk_ids
                }
            }, {
                $unset: {
                    building: true
                }
            }),

            set_special_chunk_ids.length &&
            md_store.DataChunk.collection.updateMany({
                _id: {
                    $in: set_special_chunk_ids
                }
            }, {
                $set: {
                    special_replica: true,
                }
            }),

            unset_special_chunk_ids.length &&
            md_store.DataChunk.collection.updateMany({
                _id: {
                    $in: unset_special_chunk_ids
                }
            }, {
                $unset: {
                    special_replica: true,
                }
            })
        );
    }
}


exports.MapBuilder = MapBuilder;
