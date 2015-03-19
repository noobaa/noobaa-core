/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var jwt = require('jsonwebtoken');
var db = require('./db');
var api = require('../api');
var range_utils = require('../util/range_utils');
var promise_utils = require('../util/promise_utils');
var block_allocator = require('./block_allocator');
var Semaphore = require('noobaa-util/semaphore');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);

var p2p_context = {};

/**
 *
 * General:
 *
 * object = file
 * part = part of a file logically, points to a chunk
 * chunk = actual data of the part can be used by several object parts if identical
 * block = representation of a chunk on a specific node
 * fragment = if we use erasure coding than a chunk is divided to fragments where if we lose one we can rebuild it using the rest.
 *            each fragment will be replicated to x nodes as blocks
 *
 */
module.exports = {
    allocate_object_parts: allocate_object_parts,
    finalize_object_parts: finalize_object_parts,
    read_object_mappings: read_object_mappings,
    read_node_mappings: read_node_mappings,
    delete_object_mappings: delete_object_mappings,
    bad_block_in_part: bad_block_in_part,
    build_chunks: build_chunks,
};

// default split of chunks with kfrag
var CHUNK_KFRAG_BITWISE = 0; // TODO: pick kfrag?
var CHUNK_KFRAG = 1 << CHUNK_KFRAG_BITWISE;


/**
 *
 * allocate_object_parts - allocates the object parts, chunks and blocks and writes it to the db
 *
 */
function allocate_object_parts(bucket, obj, parts) {
    if (!bucket.tiering || bucket.tiering.length !== 1) {
        throw new Error('only single tier supported per bucket/chunk');
    }
    var tier_id = bucket.tiering[0].tier;

    var new_chunks = [];
    var dupped_chunks = [];
    var new_parts = [];

    var reply = {
        parts: _.times(parts.length, function() {
            return {};
        })
    };

    // dedup with existing chunks by lookup of crypt.hash_val
    return Q.fcall(function() {
            if (process.env.DEDUP_DISABLED === 'true') {
                return;
            }
            return db.DataChunk
                .find({
                    system: obj.system,
                    tier: tier_id,
                    'crypt.hash_val': {
                        $in: _.map(parts, function(part) {
                            return part.crypt.hash_val;
                        })
                    },
                    deleted: null,
                })
                .exec();
        })
        .then(function(dup_chunks) {
            var hash_val_to_dup_chunk = _.indexBy(dup_chunks, function(chunk) {
                return chunk.crypt.hash_val;
            });

            //No dup chunks, no need to query their blocks
            if (!dup_chunks) {
                return hash_val_to_dup_chunk;
            }
            //Query all blocks of the found dup chunks
            var query_chunks_ids = _.flatten(_.map(hash_val_to_dup_chunk, '_id'));
            return Q.when(
                    db.DataBlock
                    .find({
                        chunk: {
                            $in: query_chunks_ids
                        },
                        deleted: null,
                    })
                    .populate('node')
                    .exec())
                //Associate all the blocks with their (dup_)chunks
                .then(function(queried_blocks) {
                    var blocks_by_chunk_id = _.groupBy(queried_blocks, 'chunk');
                    _.each(blocks_by_chunk_id, function(blocks, chunk_id) {
                        _.each(hash_val_to_dup_chunk, function(key) {
                            if (hash_val_to_dup_chunk[key]._id.toString() === chunk_id) {
                                hash_val_to_dup_chunk[key].all_blocks = blocks;
                            }
                        });
                    });
                    return hash_val_to_dup_chunk;
                });
        })
        .then(function(hash_val_to_dup_chunk) {
            _.each(parts, function(part, i) {
                // chunk size is aligned up to be an integer multiple of kfrag*block_size
                var chunk_size = range_utils.align_up_bitwise(part.chunk_size, CHUNK_KFRAG_BITWISE);
                var dup_chunk = hash_val_to_dup_chunk[part.crypt.hash_val];
                var chunk;
                if (dup_chunk) {
                    chunk = dup_chunk;
                    //Verify chunk health
                    var merged_status = false,
                        dup_chunk_status = analyze_chunk_status(dup_chunk, dup_chunk.all_blocks);
                    for (var f = 0; f < dup_chunk_status.fragments.length; ++f) {
                        if (dup_chunk_status.fragments[f].health !== 'unavailable') {
                            merged_status = true;
                            break;
                        }
                    }
                    if (merged_status) {
                        //Chunk health is ok, we can mark it as dedup
                        dbg.log3('chunk ', dup_chunk, 'is dupped and available');
                        reply.parts[i].dedup = true;
                    } else {
                        //Chunk is not healthy, create a new fragment on it
                        dbg.log3('chunk ', dup_chunk, 'is dupped but unavailable, allocating new blocks for it');
                        dupped_chunks.push(chunk);
                    }
                } else {
                    chunk = new db.DataChunk({
                        system: obj.system,
                        tier: tier_id,
                        size: chunk_size,
                        kfrag: CHUNK_KFRAG,
                        crypt: part.crypt,
                    });
                    new_chunks.push(chunk);
                }
                new_parts.push(new db.ObjectPart({
                    system: obj.system,
                    obj: obj.id,
                    start: part.start,
                    end: part.end,
                    chunks: [{
                        chunk: chunk,
                        // chunk_offset: 0, // not required
                    }]
                }));
            });
            dbg.log2('allocate_blocks');
            return block_allocator.allocate_blocks(
                obj.system,
                tier_id,
                //Allocate both for the new chunks, and the unavailable dupped chunks
                _.map(new_chunks.concat(dupped_chunks), function(chunk) {
                    return {
                        chunk: chunk,
                        fragment: 0
                    };
                }));
        })
        .then(function(new_blocks) {
            var blocks_by_chunk = _.groupBy(new_blocks, function(block) {
                return block.chunk._id;
            });
            _.each(new_parts, function(part, i) {
                var reply_part = reply.parts[i];
                if (reply_part.dedup) return;
                var new_blocks = blocks_by_chunk[part.chunks[0].chunk];
                var chunk = new_blocks[0].chunk;
                dbg.log0('part info', part,
                    'chunk', chunk,
                    'blocks', new_blocks);
                reply_part.part = get_part_info({
                    part: part,
                    chunk: chunk,
                    blocks: new_blocks,
                    building: true
                });
            });
            dbg.log2('create blocks', new_blocks.length);
            return db.DataBlock.create(new_blocks);
        })
        .then(function() {
            dbg.log2('create chunks', new_chunks);
            return db.DataChunk.create(new_chunks);
        })
        .then(function() {
            dbg.log2('create parts', new_parts);
            return db.ObjectPart.create(new_parts);
        })
        .thenResolve(reply);
}



/**
 *
 * finalize_object_parts - after the 1st block was uploaded, this creates more blocks on other nodes to replicate to
 * but only in the db
 *
 */
function finalize_object_parts(bucket, obj, parts) {
    var block_ids = _.flatten(_.map(parts, 'block_ids'));
    dbg.log3('finalize_object_parts', block_ids);
    var chunks;
    return Q.all([

            // find parts by start offset
            db.ObjectPart
            .find({
                obj: obj.id,
                start: {
                    $in: _.map(parts, 'start')
                }
            })
            .populate('chunks.chunk')
            .exec(),

            // find blocks by list of ids
            (block_ids.length ?
                db.DataBlock
                .find({
                    _id: {
                        $in: block_ids
                    }
                })
                .exec() : null
            )
        ])
        .spread(function(parts_res, blocks) {
            var blocks_by_id = _.indexBy(blocks, '_id');
            var parts_by_start = _.groupBy(parts_res, 'start');
            chunks = _.flatten(_.map(parts, function(part) {
                var part_res = parts_by_start[part.start];
                if (!part_res) {
                    throw new Error('part not found ' +
                        obj.id + ' ' + range_utils.human_range(part));
                }
                return _.map(part_res, function(p) {
                    return p.chunks[0].chunk;
                });
            }));
            var chunk_by_id = _.indexBy(chunks, '_id');
            _.each(blocks, function(block) {
                dbg.log3('going to finalize block ', block);
                if (!block.building) {
                    throw new Error('block not in building mode');
                }
                var chunk = chunk_by_id[block.chunk];
                if (!chunk) {
                    throw new Error('missing block chunk');
                }
            });
            if (block_ids.length) {
                return db.DataBlock
                    .update({
                        _id: {
                            $in: block_ids
                        }
                    }, {
                        $unset: {
                            building: 1
                        }
                    }, {
                        multi: true
                    })
                    .exec();
            }
        })
        .then(function() {
            var retries = 0;

            function call_build_chunk() {
                return Q.fcall(function() {
                    return build_chunks(chunks);
                }).then(function(res) {
                    return res;
                }, function(err) {
                    dbg.log0("Caught ", err, " Retrying replicate to another node... ");
                    ++retries;
                    if (retries >= config.replicate_retry) {
                        throw new Error("Failed replicate (after retries)", err, err.stack);
                    }
                    return call_build_chunk();
                });
            }
            return call_build_chunk();
        })
        .then(function() {
            var end = parts[parts.length - 1].end;
            if (end > obj.upload_size) {
                return obj.update({
                    upload_size: end
                }).exec();
            }
        })
        .then(null, function(err) {
            console.error('error finalize_object_parts ' + err + ' ; ' + err.stack);
            throw err;
        });
}


/**
 *
 * read_object_mappings
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 * @params: obj, start, end, skip, limit
 */
function read_object_mappings(params) {
    var rng = sanitize_object_range(params.obj, params.start, params.end);
    if (!rng) { // empty range
        return [];
    }
    var start = rng.start;
    var end = rng.end;
    var parts;

    return Q.fcall(function() {

            // find parts intersecting the [start,end) range
            var find = db.ObjectPart
                .find({
                    obj: params.obj.id,
                    start: {
                        $lt: end
                    },
                    end: {
                        $gt: start
                    },
                })
                .sort('start')
                .populate('chunks.chunk');
            if (params.skip) find.skip(params.skip);
            if (params.limit) find.limit(params.limit);
            return find.exec();
        })
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                details: params.details
            });
        });
}


/**
 *
 * read_node_mappings
 *
 * @params: node, skip, limit
 */
function read_node_mappings(params) {
    return Q.fcall(function() {
            var find = db.DataBlock
                .find({
                    node: params.node.id,
                    deleted: null,
                })
                .sort('-_id');
            if (params.skip) find.skip(params.skip);
            if (params.limit) find.limit(params.limit);
            return find.exec();
        })
        .then(function(blocks) {
            return db.ObjectPart
                .find({
                    'chunks.chunk': {
                        $in: _.map(blocks, 'chunk')
                    }
                })
                .populate('chunks.chunk')
                .populate('obj')
                .exec();
        })
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                set_obj: true,
                details: true
            });
        })
        .then(function(parts) {
            var objects = {};
            var parts_per_obj_id = _.groupBy(parts, function(part) {
                var obj = part.obj;
                delete part.obj;
                objects[obj.id] = obj;
                return obj.id;
            });
            return _.map(objects, function(obj, obj_id) {
                return {
                    key: obj.key,
                    parts: parts_per_obj_id[obj_id],
                };
            });
        });
}



/**
 *
 * read_parts_mappings
 *
 * parts should have populated chunks
 *
 * @params: parts, set_obj, details
 */
function read_parts_mappings(params) {
    var chunks = _.pluck(_.flatten(_.map(params.parts, 'chunks')), 'chunk');
    var chunk_ids = _.pluck(chunks, 'id');

    // find all blocks of the resulting parts
    return Q.when(db.DataBlock
            .find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .sort('fragment')
            .populate('node')
            .exec())
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            var parts_reply = _.map(params.parts, function(part) {
                if (!part.chunks || part.chunks.length !== 1) {
                    throw new Error('only single tier supported per bucket/chunk');
                }
                var chunk = part.chunks[0].chunk;
                var blocks = blocks_by_chunk[chunk.id];
                return get_part_info({
                    part: part,
                    chunk: chunk,
                    blocks: blocks,
                    set_obj: params.set_obj,
                    details: params.details
                });
            });
            return parts_reply;
        });
}



/**
 *
 * delete_object_mappings
 *
 */
function delete_object_mappings(obj) {
    // find parts intersecting the [start,end) range
    return Q.when(db.ObjectPart
            .find({
                obj: obj.id,
            })
            .populate('chunks.chunk')
            .exec())
        .then(function(parts) {
            var chunks = _.pluck(_.flatten(_.map(parts, 'chunks')), 'chunk');
            var chunk_ids = _.pluck(chunks, 'id');
            var in_chunk_ids = {
                $in: chunk_ids
            };
            var chunk_query = {
                _id: in_chunk_ids
            };
            var block_query = {
                chunk: in_chunk_ids
            };
            var deleted_update = {
                deleted: new Date()
            };
            var multi_opt = {
                multi: true
            };
            return Q.all([
                db.DataChunk.update(chunk_query, deleted_update, multi_opt).exec(),
                db.DataBlock.update(block_query, deleted_update, multi_opt).exec()
            ]);
        });
}



/**
 *
 * bad_block_in_part
 *
 * @params: obj, start, end, fragment, block_id, is_write
 *
 */
function bad_block_in_part(params) {
    return Q.all([
            db.DataBlock.findById(params.block_id).exec(),
            db.ObjectPart.findOne({
                system: params.obj.system,
                obj: params.obj.id,
                start: params.start,
                end: params.end,
            })
            .populate('chunks.chunk')
            .exec(),
        ])
        .spread(function(block, part) {
            if (!part || !part.chunks || !part.chunks[0] || !part.chunks[0].chunk) {
                console.error('bad block - invalid part/chunk', block, part);
                throw new Error('invalid bad block request');
            }
            var chunk = part.chunks[0].chunk;
            if (!block || block.fragment !== params.fragment ||
                String(block.chunk) !== String(chunk.id)) {
                console.error('bad block - invalid block', block, part);
                throw new Error('invalid bad block request');
            }

            if (params.is_write) {
                var new_block;

                return block_allocator.reallocate_bad_block(chunk, block)
                    .then(function(new_block_arg) {
                        new_block = new_block_arg;
                        return db.DataBlock.create(new_block);
                    })
                    .then(function() {
                        return get_block_address(new_block);
                    });

            } else {
                // TODO mark the block as bad for next reads and decide when to trigger rebuild
            }

        });
}



/**
 *
 * build_chunks
 *
 */
function build_chunks(chunks) {
    var blocks_to_remove = [];
    var blocks_to_build = [];
    var blocks_info_to_allocate = [];
    var chunk_ids = _.pluck(chunks, '_id');
    var in_chunk_ids = {
        $in: chunk_ids
    };

    dbg.log0('build_chunks:', 'batch start', chunks.length, 'chunks');

    function push_block_to_remove(chunk, fragment, block, reason) {
        dbg.log0('build_chunks:', 'remove block (' + reason + ') -',
            'chunk', chunk._id, 'fragment', fragment, 'block', block._id);
        blocks_to_remove.push(block);
    }

    return Q.all([ // parallel queries
            Q.fcall(function() {

                // load blocks of the chunk
                // TODO: sort by _id is a hack to make consistent decisions between
                // different servers or else they might decide to remove different blocks
                // and leave no good blocks...
                return db.DataBlock
                    .find({
                        chunk: in_chunk_ids,
                        deleted: null,
                    })
                    .populate('node')
                    .sort('_id')
                    .exec();
            }),
            Q.fcall(function() {

                // update the chunks to building mode
                return db.DataChunk.update({
                    _id: in_chunk_ids
                }, {
                    building: new Date(),
                }, {
                    multi: true
                }).exec();
            })
        ])
        .spread(function(all_blocks, chunks_updated) {

            var blocks_by_chunk = _.groupBy(all_blocks, 'chunk');
            _.each(chunks, function(chunk) {
                var chunk_blocks = blocks_by_chunk[chunk._id];
                var chunk_status = analyze_chunk_status(chunk, chunk_blocks);
                array_push_all(blocks_to_remove, chunk_status.blocks_to_remove);
                array_push_all(blocks_info_to_allocate, chunk_status.blocks_info_to_allocate);
            });

            return Q.all([
                Q.fcall(function() {

                    // remove unneeded blocks from db
                    if (!blocks_to_remove.length) return;
                    dbg.log0('build_chunks:', 'removing', blocks_to_remove.length, 'blocks');
                    return block_allocator.remove_blocks(blocks_to_remove);
                }),
                Q.fcall(function() {

                    // allocate blocks
                    if (!blocks_info_to_allocate.length) return;
                    var blocks_info_by_tier = _.groupBy(blocks_info_to_allocate, 'tier_id');
                    return Q.all(_.map(blocks_info_by_tier, function(blocks_info) {
                            return block_allocator.allocate_blocks(
                                blocks_info[0].system_id,
                                blocks_info[0].tier_id,
                                blocks_info);
                        }))
                        .then(function(res) {

                            // append new blocks to build list
                            var new_blocks = _.flatten(res);
                            array_push_all(blocks_to_build, new_blocks);

                            // create in db (in building mode)
                            dbg.log0('build_chunks:', 'creating', new_blocks.length, 'blocks');
                            return db.DataBlock.create(new_blocks);
                        });
                })
            ]);
        })
        .then(function() {

            // replicate each block in building mode
            // send to the agent a request to replicate from the source

            if (!blocks_to_build.length) return;
            var sem = new Semaphore(config.REPLICATE_CONCURRENCY);

            dbg.log0('build_chunks:', 'replicating', blocks_to_build.length, 'blocks');
            return Q.all(_.map(blocks_to_build, function(block) {
                    return sem.surround(function() {
                        var block_addr = get_block_address(block);
                        var source_addr = get_block_address(block.source);
                        var agent = new api.agent_api.Client();
                        agent.options.set_address(block_addr.host);
                        agent.options.set_peer(block_addr.peer);
                        agent.options.set_is_ws();
                        agent.options.set_p2p_context(p2p_context);
                        agent.options.set_timeout(30000);

                        return agent.replicate_block({
                                block_id: block._id.toString(),
                                source: source_addr
                            }).then(function() {
                                dbg.log3('replicated block', block._id);
                            }, function(err) {

                                if (err && (typeof err === 'string' || err instanceof String) && err.indexOf('ECONNRESET') >= 0) {
                                    dbg.log0('ERROR replicate block 1', block._id, block_addr.host, err); // TODO retry options
                                    throw err;
                                } else {
                                    dbg.log0('ERROR replicate block 2', block._id, block_addr.host, err);
                                    throw err;
                                }
                            })
                            .thenResolve(block._id);
                    });
                }))
                .then(function(built_block_ids) {
                    dbg.log0('replicated blocks', built_block_ids);

                    if (built_block_ids.length < blocks_to_build.length) {
                        _.each(blocks_to_build, function(blockObj) {
                            if (!_.indexOf(built_block_ids, blockObj._id)) {
                                dbg.log0('replicated blocks block not handled', blockObj._id);
                            }
                        });
                    }

                    // update building blocks to remove the building mode timestamp
                    return db.DataBlock.update({
                        _id: {
                            $in: built_block_ids
                        }
                    }, {
                        $unset: {
                            building: 1
                        }
                    }, {
                        multi: true
                    }).exec();
                });
        })
        .then(function() {

            // complete chunks build state - remove the building time and set last_build time
            dbg.log0('build_chunks:', 'batch end', chunks.length, 'chunks');
            return db.DataChunk.update({
                _id: in_chunk_ids
            }, {
                last_build: new Date(),
                $unset: {
                    building: 1
                }
            }, {
                multi: true
            }).exec();
        });
}




/**
 *
 * BUILD_CHUNKS_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 */
var build_chunks_worker =

    (process.env.BUILD_WORKER_DISABLED === 'true') ||
    promise_utils.run_background_worker({
        name: 'build_chunks_worker',
        batch_size: 50,
        time_since_last_build: 60000, // TODO increase...
        building_timeout: 300000, // TODO increase...

        /**
         * run the next batch of build_chunks
         */
        run_batch: function() {
            var self = this;
            return Q.fcall(function() {
                    var now = Date.now();
                    var query = {
                        $and: [{
                            $or: [{
                                last_build: null
                            }, {
                                last_build: {
                                    $lt: new Date(now - self.time_since_last_build)
                                }
                            }]
                        }, {
                            $or: [{
                                building: null
                            }, {
                                building: {
                                    $lt: new Date(now - self.building_timeout)
                                }
                            }]
                        }]
                    };
                    if (self.last_chunk_id) {
                        query._id = {
                            $gt: self.last_chunk_id
                        };
                    } else {
                        dbg.log0('BUILD_WORKER:', 'BEGIN');
                    }

                    return db.DataChunk.find(query)
                        .limit(self.batch_size)
                        .exec();
                })
                .then(function(chunks) {

                    // update the last_chunk_id for next time
                    if (chunks.length === self.batch_size) {
                        self.last_chunk_id = chunks[chunks.length - 1]._id;
                    } else {
                        self.last_chunk_id = undefined;
                    }

                    if (chunks.length) {
                        return build_chunks(chunks);
                    }
                })
                .then(function() {
                    // return the delay before next batch
                    if (self.last_chunk_id) {
                        dbg.log0('BUILD_WORKER:', 'CONTINUE', self.last_chunk_id);
                        return 250;
                    } else {
                        dbg.log0('BUILD_WORKER:', 'END');
                        return 60000;
                    }
                }, function(err) {
                    // return the delay before next batch
                    dbg.log0('BUILD_WORKER:', 'ERROR', err, err.stack);
                    return 10000;
                });
        }
    });







// UTILS //////////////////////////////////////////////////////////




// TODO take config of desired replicas from tier/bucket
var OPTIMAL_REPLICAS = 3;
// TODO move times to config constants/env
var LONG_GONE_THRESHOLD = 3600000;
var SHORT_GONE_THRESHOLD = 300000;
var LONG_BUILD_THRESHOLD = 300000;


/**
 *
 * analyze_chunk_status
 *
 * compute the status in terms of availability
 * of the chunk blocks per fragment and as a whole.
 *
 */
function analyze_chunk_status(chunk, all_blocks) {
    var now = Date.now();
    var blocks_by_fragments = _.groupBy(all_blocks, 'fragment');
    var blocks_info_to_allocate;
    var blocks_to_remove;

    // TODO loop over parity fragments too
    var fragments = _.times(chunk.kfrag, function(fragment_index) {

        var fragment = {
            index: fragment_index,
            blocks: blocks_by_fragments[fragment_index] || []
        };

        // sorting the blocks by last node heartbeat time and by srvmode and building,
        // so that reading will be served by most available node.
        // TODO better randomize order of blocks for some time frame
        // TODO need stable sorting here for parallel decision making...
        fragment.blocks.sort(block_access_sort);

        dbg.log1('analyze_chunk_status:', 'chunk', chunk._id,
            'fragment', fragment_index, 'num blocks', fragment.blocks.length);

        _.each(fragment.blocks, function(block) {
            var since_hb = now - block.node.heartbeat.getTime();
            if (since_hb > LONG_GONE_THRESHOLD || block.node.srvmode === 'disabled') {
                return array_push(fragment, 'long_gone_blocks', block);
            }
            if (since_hb > SHORT_GONE_THRESHOLD) {
                return array_push(fragment, 'short_gone_blocks', block);
            }
            if (block.building) {
                var since_bld = now - block.building.getTime();
                if (since_bld > LONG_BUILD_THRESHOLD) {
                    return array_push(fragment, 'long_building_blocks', block);
                } else {
                    return array_push(fragment, 'building_blocks', block);
                }
            }
            if (!block.node.srvmode) {
                array_push(fragment, 'good_blocks', block);
            }
            // also keep list of blocks that we can use to replicate from
            if (!block.node.srvmode || block.node.srvmode === 'decommissioning') {
                array_push(fragment, 'accessible_blocks', block);
            }
        });

        var num_accessible_blocks = fragment.accessible_blocks ?
            fragment.accessible_blocks.length : 0;
        var num_good_blocks = fragment.good_blocks ?
            fragment.good_blocks.length : 0;

        if (!num_accessible_blocks) {
            fragment.health = 'unavailable';
        }

        if (num_good_blocks > OPTIMAL_REPLICAS) {
            blocks_to_remove = blocks_to_remove || [];

            // remove all blocks that were building for too long
            // as they most likely failed to build.
            array_push_all(blocks_to_remove, fragment.long_building_blocks);

            // remove all long gone blocks
            // defer the short gone blocks until either back to good or become long.
            array_push_all(blocks_to_remove, fragment.long_gone_blocks);

            // remove extra good blocks when good blocks are above optimal
            // and not just accesible blocks are above optimal
            array_push_all(blocks_to_remove, fragment.good_blocks.slice(OPTIMAL_REPLICAS));
        }

        if (num_good_blocks < OPTIMAL_REPLICAS && num_accessible_blocks) {

            fragment.health = 'repairing';

            // will allocate blocks for fragment to reach optimal count
            blocks_info_to_allocate = blocks_info_to_allocate || [];
            var round_rob = 0;
            var num_blocks_to_add = Math.max(0, OPTIMAL_REPLICAS - num_good_blocks);
            _.times(num_blocks_to_add, function() {
                blocks_info_to_allocate.push({
                    system_id: chunk.system,
                    tier_id: chunk.tier,
                    chunk_id: chunk._id,
                    chunk: chunk,
                    fragment: fragment_index,
                    source: fragment.accessible_blocks[
                        round_rob % fragment.accessible_blocks.length]
                });
                round_rob += 1;
            });
        }

        fragment.health = fragment.health || 'healthy';

        return fragment;
    });

    return {
        fragments: fragments,
        blocks_info_to_allocate: blocks_info_to_allocate,
        blocks_to_remove: blocks_to_remove,
    };
}


// see http://jsperf.com/concat-vs-push-apply/39
var _cached_array_push = Array.prototype.push;


/**
 * add to array, create it in the object if doesnt exist
 */
function array_push(obj, arr_name, item) {
    var arr = obj[arr_name];
    if (arr) {
        _cached_array_push.call(arr, item);
    } else {
        obj[arr_name] = [item];
    }
}


/**
 * push list of items into array
 */
function array_push_all(array, items) {
    // see http://jsperf.com/concat-vs-push-apply/39
    // using Function.apply with items list to sends all the items
    // to the push function which actually does: array.push(items[0], items[1], ...)
    _cached_array_push.apply(array, items);
}


function get_part_info(params) {
    var chunk_status = analyze_chunk_status(params.chunk, params.blocks);
    var p = _.pick(params.part, 'start', 'end', 'chunk_offset');

    p.fragments = _.map(chunk_status.fragments, function(fragment) {
        var blocks = params.building && fragment.building_blocks ||
            params.details && fragment.blocks ||
            fragment.accessible_blocks;

        var part_fragment = {};

        if (params.details) {
            part_fragment.details = {
                health: fragment.health,
            };
        }

        part_fragment.blocks = _.map(blocks, function(block) {
            var block_info = {
                address: get_block_address(block),
            };
            var node = block.node;
            if (params.details) {
                var details = {
                    tier_name: 'nodes', // TODO get tier name
                    node_name: node.name,
                    online: node.is_online(),
                };
                if (node.srvmode) {
                    details.srvmode = node.srvmode;
                }
                if (block.building) {
                    details.building = true;
                }
                block_info.details = details;
            }
            return block_info;
        });
        return part_fragment;
    });

    p.kfrag = params.chunk.kfrag;
    p.crypt = _.pick(params.chunk.crypt, 'hash_type', 'hash_val', 'cipher_type', 'cipher_val');
    p.chunk_size = params.chunk.size;
    p.chunk_offset = p.chunk_offset || 0;
    if (params.set_obj) {
        p.obj = params.part.obj;
    }
    return p;
}


function get_block_address(block) {
    var b = {};
    b.id = block._id.toString();
    b.host = 'http://' + block.node.ip;
    if (block.node.port) {
        b.host += ':' + block.node.port;
    }

    if (block.node.peer_id) {
        if (process.env.JWT_SECRET_PEER) {
            var jwt_options = {
                expiresInMinutes: 60
            };
            b.peer = jwt.sign(block.node.peer_id,
                process.env.JWT_SECRET_PEER, jwt_options);
        } else {
            b.peer = block.node.peer_id;
        }
    }
    return b;
}


// sanitizing start & end: we want them to be integers, positive, up to obj.size.
function sanitize_object_range(obj, start, end) {
    if (typeof(start) === 'undefined') {
        start = 0;
    }
    // truncate end to the actual object size
    if (typeof(end) !== 'number' || end > obj.size) {
        end = obj.size;
    }
    // force integers
    start = start | 0;
    end = end | 0;
    // force positive
    if (start < 0) {
        start = 0;
    }
    // quick check for empty range
    if (end <= start) {
        return;
    }
    return {
        start: start,
        end: end,
    };
}

/**
 * sorting function for sorting blocks with most recent heartbeat first
 */
function block_access_sort(block1, block2) {
    if (block1.building) {
        return 1;
    }
    if (block2.building) {
        return -1;
    }
    if (block1.node.srvmode) {
        return 1;
    }
    if (block2.node.srvmode) {
        return -1;
    }
    return block2.node.heartbeat.getTime() - block1.node.heartbeat.getTime();
}
