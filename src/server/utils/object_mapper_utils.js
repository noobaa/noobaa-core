'use strict';

module.exports = {
    build_chunks: build_chunks,
    get_block_md: get_block_md,
};

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
var policy_allocation = require('./policy_allocation');
var server_rpc = require('../server_rpc').server_rpc;
var promise_utils = require('../../util/promise_utils');
var js_utils = require('../../util/js_utils');
var config = require('../../../config.js');
var Semaphore = require('../../util/semaphore');
var dbg = require('../../util/debug_module')(__filename);


var replicate_block_sem = new Semaphore(config.REPLICATE_CONCURRENCY);

/**
 *
 * build_chunks
 *
 * process list of chunk in a batch, and for each one make sure they are well built,
 * meaning that their blocks are available, by creating new blocks and replicating
 * them from accessible blocks, and removing unneeded blocks.
 *
 */
function build_chunks(chunks) {
    var chunks_status;
    var remove_blocks_promise;
    var had_errors = 0;
    var replicated_block_ids = [];
    var replicated_failed_ids = [];
    var chunk_ids = _.pluck(chunks, '_id');
    var chunk_ids_need_update_to_building = _.compact(_.map(chunks, function(chunk) {
        return chunk.building ? null : chunk._id;
    }));

    dbg.log1('build_chunks:', 'batch start', chunks.length, 'chunks');

    return P.all([ // parallel queries

            // load blocks of the chunk
            // TODO: sort by _id is a hack to make consistent decisions between
            // different servers or else they might decide to remove different blocks
            // and leave no good blocks...
            db.DataBlock.find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .populate('node')
            .sort('_id')
            .exec(),


            // update the chunks to building mode
            chunk_ids_need_update_to_building.length &&
            db.DataChunk.collection.updateMany({
                _id: {
                    $in: chunk_ids_need_update_to_building
                }
            }, {
                $set: {
                    building: new Date(),
                }
            }, {
                multi: true
            }) //.exec()
        ])
        .spread(function(all_blocks, chunks_updated) {

            // analyze chunks

            var blocks_by_chunk = _.groupBy(all_blocks, 'chunk');
            var blocks_to_remove = [];
            return P.all(_.map(chunks, function(chunk) {
                    var chunk_blocks = blocks_by_chunk[chunk._id];
                    var chunk_status = policy_allocation.analyze_chunk_status(chunk, chunk_blocks);
                    js_utils.array_push_all(blocks_to_remove, chunk_status.blocks_to_remove);
                    return chunk_status;
                }))
                .then(function(chunks_status) {

                    // remove blocks -
                    // submit this to run in parallel while doing the longer allocate path.
                    // and will wait for it below before returning.

                    if (blocks_to_remove.length) {
                        dbg.log0('build_chunks: removing blocks', blocks_to_remove.length);
                        remove_blocks_promise = policy_allocation.remove_allocation(blocks_to_remove);
                    }

                    // allocate blocks

                    return promise_utils.iterate(chunks_status, function(chunk_status) {
                        var avoid_nodes = _.map(chunk_status.all_blocks, function(block) {
                            return block.node._id.toString();
                        });
                        dbg.log1('build_chunks: chunk', _.get(chunk_status, 'chunk._id'),
                            'all_blocks', _.get(chunk_status, 'all_blocks.length'),
                            'blocks_info_to_allocate', _.get(chunk_status, 'blocks_info_to_allocate.length'));
                        return promise_utils.iterate(chunk_status.blocks_info_to_allocate,
                            function(block_info_to_allocate) {
                                return policy_allocation.allocate_by_policy(block_info_to_allocate.chunk, avoid_nodes)
                                    .then(function(new_block) {
                                        if (!new_block) {
                                            had_errors += 1;
                                            dbg.error('build_chunks: no nodes for allocation.' +
                                                ' continue to build but will not eventually fail');
                                            return;
                                        }
                                        block_info_to_allocate.block = new_block;
                                        avoid_nodes.push(new_block.node._id.toString());
                                        new_block.digest_type = block_info_to_allocate.source.digest_type;
                                        new_block.digest_b64 = block_info_to_allocate.source.digest_b64;
                                        return new_block;
                                    });
                            });
                    });
                });
        })
        .then(function(new_blocks) {
            // create blocks in db (in building mode)

            if (!new_blocks || !new_blocks.length) return;
            new_blocks = _.compact(_.flatten(new_blocks));
            dbg.log2('build_chunks: creating blocks', new_blocks);
            // return db.DataBlock.create(new_blocks);
            return new_blocks.length && db.DataBlock.collection.insertMany(_.map(new_blocks, function(x) {
                x = _.clone(x);
                // x.system = x.system._id;
                // x.tier = x.tier._id;
                x.node = x.node._id;
                x.chunk = x.chunk._id;
                return x;
            }));
        })
        .then(function() {

            // replicate blocks
            // send to the agent a request to replicate from the source

            return P.all(_.map(chunks_status, function(chunk_status) {
                return P.all(_.map(chunk_status.blocks_info_to_allocate,
                    function(block_info_to_allocate) {
                        var block = block_info_to_allocate.block;
                        if (!block) {
                            // block that failed to allocate - skip replicate anyhow.
                            return;
                        }
                        var target = get_block_md(block);
                        var source = get_block_md(block_info_to_allocate.source);

                        dbg.log1('replicating to', target, 'from', source, 'chunk', chunk_status.chunk);
                        return replicate_block_sem.surround(function() {
                            return server_rpc.client.agent.replicate_block({
                                target: target,
                                source: source
                            }, {
                                address: target.address,
                            });
                        }).then(function() {
                            dbg.log1('build_chunks replicated block', block._id,
                                'to', target.address, 'from', source.address);
                            replicated_block_ids.push(block._id);
                        }, function(err) {
                            dbg.error('build_chunks FAILED replicate block', block._id,
                                'to', target.address, 'from', source.address,
                                err.stack || err);
                            replicated_failed_ids.push(block._id);
                            block_info_to_allocate.replicate_error = err;
                            chunk_status.replicate_error = err;
                            had_errors += 1;
                            // don't fail here yet to allow handling the successful blocks
                            // so just keep the error, and we will fail at the end of build_chunks
                        });
                    }));
            }));

        })
        .then(function() {

            // update building blocks to remove the building mode timestamp

            dbg.log2("build_chunks unset block building mode ", replicated_block_ids);

            // success chunks - remove the building time and set last_build time
            var success_chunks_status = _.reject(chunks_status, 'replicate_error');
            var success_chunk_ids = _.map(success_chunks_status, function(chunk_status) {
                return chunk_status.chunk._id;
            });
            dbg.log2('build_chunks: success chunks', success_chunk_ids.length);

            // failed chunks - remove only the building time
            // but leave last_build so that worker will retry
            var failed_chunks_status = _.filter(chunks_status, 'replicate_error');
            var failed_chunk_ids = _.map(failed_chunks_status, function(chunk_status) {
                return chunk_status.chunk._id;
            });
            dbg.log2('build_chunks: failed chunks', failed_chunk_ids.length);

            return P.all([
                // wait for blocks to be removed here before finishing
                remove_blocks_promise,

                replicated_block_ids.length &&
                db.DataBlock.collection.updateMany({
                    _id: {
                        $in: replicated_block_ids
                    }
                }, {
                    $unset: {
                        building: ''
                    }
                }, {
                    multi: true
                }),
                // .exec(),

                // actually remove failed replications and not just mark as deleted
                // because otherwise this may bloat when continuous build errors occur
                replicated_failed_ids.length &&
                db.DataBlock.collection.deleteMany({
                    _id: {
                        $in: replicated_failed_ids
                    }
                }, {
                    multi: true
                }),
                // .exec(),

                success_chunk_ids.length &&
                db.DataChunk.collection.updateMany({
                    _id: {
                        $in: success_chunk_ids
                    }
                }, {
                    $set: {
                        last_build: new Date(),
                    },
                    $unset: {
                        building: ''
                    }
                }, {
                    multi: true
                }),
                // .exec(),

                failed_chunk_ids.length &&
                db.DataChunk.collection.updateMany({
                    _id: {
                        $in: failed_chunk_ids
                    }
                }, {
                    $unset: {
                        building: ''
                    }
                }, {
                    multi: true
                })
                // .exec()
            ]);
        })
        .then(function() {

            // return error from the promise if any replication failed,
            // so that caller will know the build isn't really complete
            if (had_errors) {
                throw new Error('build_chunks had errors');
            }

        });
}


function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = block._id.toString();
    b.address = block.node.rpc_address;
    return b;
}
