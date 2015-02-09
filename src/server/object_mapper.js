/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var db = require('./db');
var api = require('../api');
var range_utils = require('../util/range_utils');
var block_allocator = require('./block_allocator');
var Semaphore = require('noobaa-util/semaphore');
var dbg = require('../util/dbg')(__filename);

module.exports = {
    allocate_object_part: allocate_object_part,
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
 * allocate_object_part
 *
 */
function allocate_object_part(bucket, obj, start, end, chunk_size, crypt) {
    // chunk size is aligned up to be an integer multiple of kfrag*block_size
    chunk_size = range_utils.align_up_bitwise(chunk_size, CHUNK_KFRAG_BITWISE);

    if (!bucket.tiering || bucket.tiering.length !== 1) {
        throw new Error('only single tier supported per bucket/chunk');
    }

    var new_chunk = new db.DataChunk({
        system: obj.system,
        tier: bucket.tiering[0].tier,
        size: chunk_size,
        kfrag: CHUNK_KFRAG,
        crypt: crypt,
    });
    var new_part = new db.ObjectPart({
        system: obj.system,
        obj: obj.id,
        start: start,
        end: end,
        chunks: [{
            chunk: new_chunk,
            // chunk_offset: 0, // not required
        }]
    });
    var reply = {};

    return Q.when(db.DataChunk.findOne({
            system: obj.system,
            tier: bucket.tiering[0].tier,
            'crypt.hash_val': crypt.hash_val,
            deleted: null,
        }).exec())
        .then(function(dup_chunk) {
            if (dup_chunk) {
                reply.dedup = true;
                new_part.chunks[0].chunk = dup_chunk;
                return;
            }
            // console.log('create chunk', new_chunk);
            return db.DataChunk.create(new_chunk)
                .then(function() {
                    // console.log('allocate_blocks_for_chunk');
                    return block_allocator.allocate_blocks_for_chunk(new_chunk);
                })
                .then(function(new_blocks) {
                    // console.log('create blocks', new_blocks);
                    reply.part = get_part_info(new_part, new_chunk, new_blocks);
                    return db.DataBlock.create(new_blocks);
                });
        })
        .then(function() {
            // console.log('create part', new_part);
            return db.ObjectPart.create(new_part);
        })
        .then(function() {
            console.log('part info', reply);
            return reply;
        });
}


/**
 *
 * read_node_mappings
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 */
function read_object_mappings(obj, start, end, skip, limit) {
    var rng = sanitize_object_range(obj, start, end);
    if (!rng) { // empty range
        return [];
    }
    start = rng.start;
    end = rng.end;
    var parts;

    return Q.fcall(function() {

            // find parts intersecting the [start,end) range
            var find = db.ObjectPart
                .find({
                    obj: obj.id,
                    start: {
                        $lt: end
                    },
                    end: {
                        $gt: start
                    },
                })
                .sort('start')
                .populate('chunks.chunk');
            if (skip) find.skip(skip);
            if (limit) find.limit(limit);
            return find.exec();
        })
        .then(function(parts) {
            return read_parts_mappings(parts);
        });
}


/**
 *
 * read_node_mappings
 *
 */
function read_node_mappings(node, skip, limit) {
    return Q.fcall(function() {
            var find = db.DataBlock
                .find({
                    node: node.id,
                    deleted: null,
                })
                .sort('-_id');
            if (skip) find.skip(skip);
            if (limit) find.limit(limit);
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
            return read_parts_mappings(parts, 'set_obj');
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
 */
function read_parts_mappings(parts, set_obj) {
    var chunks = _.pluck(_.flatten(_.map(parts, 'chunks')), 'chunk');
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
            var parts_reply = _.map(parts, function(part) {
                if (!part.chunks || part.chunks.length !== 1) {
                    throw new Error('only single tier supported per bucket/chunk');
                }
                var chunk = part.chunks[0].chunk;
                var blocks = blocks_by_chunk[chunk.id];
                return get_part_info(part, chunk, blocks, set_obj);
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
 */
function bad_block_in_part(obj, start, end, fragment, block_id, is_write) {
    return Q.all([
            db.DataBlock.findById(block_id).exec(),
            db.ObjectPart.findOne({
                system: obj.system,
                obj: obj.id,
                start: start,
                end: end,
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
            if (!block || block.fragment !== fragment ||
                String(block.chunk) !== String(chunk.id)) {
                console.error('bad block - invalid block', block, part);
                throw new Error('invalid bad block request');
            }

            if (is_write) {
                var new_block;

                return block_allocator.reallocate_bad_block(chunk, block)
                    .then(function(new_block_arg) {
                        new_block = new_block_arg;
                        return db.DataBlock.create(new_block);
                    })
                    .then(function() {
                        return get_block_info(new_block);
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

    function push_block_to_remove(chunk, block, fragment, reason) {
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

            // TODO take config of desired replicas from tier/bucket
            var optimal_replicas = 3;
            // TODO move times to config constants/env
            var now = Date.now();
            var long_gone_threshold = 3600000;
            var short_gone_threshold = 300000;
            var long_build_threshold = 300000;

            var blocks_by_chunk = _.groupBy(all_blocks, 'chunk');
            _.each(chunks, function(chunk) {
                var blocks_by_fragments = _.groupBy(blocks_by_chunk[chunk._id], 'fragment');
                _.times(chunk.kfrag, function(fragment) {
                    var blocks = blocks_by_fragments[fragment] || [];
                    dbg.log1('build_chunks:', 'chunk', chunk._id,
                        'fragment', fragment, 'num blocks', blocks.length);
                    var good_blocks = [];
                    var corrupted_blocks = [];
                    var long_gone_blocks = [];
                    var short_gone_blocks = [];
                    var building_blocks = [];
                    var long_building_blocks = [];

                    _.each(blocks, function(block) {
                        if (block.corrupted) return corrupted_blocks.push(block);
                        var since_hb = now - block.node.heartbeat.getTime();
                        if (since_hb > long_gone_threshold) return long_gone_blocks.push(block);
                        if (since_hb > short_gone_threshold) return short_gone_blocks.push(block);
                        if (block.building) {
                            var since_bld = now - block.building.getTime();
                            if (since_bld > long_build_threshold) {
                                return long_building_blocks.push(block);
                            } else {
                                return building_blocks.push(block);
                            }
                        }
                        good_blocks.push(block);
                    });

                    if (!good_blocks.length) {
                        // TODO try erasure coding to rebuild from other fragments
                        console.error('build_chunk:', 'NO GOOD BLOCKS',
                            'chunk', chunk._id, 'fragment', fragment,
                            'corrupted', corrupted_blocks.length,
                            'long gone', long_gone_blocks.length,
                            'short gone', short_gone_blocks.length,
                            'building', building_blocks.length,
                            'long building', long_building_blocks.length);
                        return;
                    }

                    // blocks that were building for too long will all be removed
                    // as they most likely failed to build
                    while (long_building_blocks.length) {
                        push_block_to_remove(long_building_blocks.pop(), 'long building');
                    }

                    // remove extra blocks that did not finish building
                    while (good_blocks.length + building_blocks.length > optimal_replicas) {
                        push_block_to_remove(building_blocks.pop(), 'extra building');
                    }

                    // when above optimal we can remove long gone blocks
                    // defer the short gone blocks until either back to good or become long.
                    if (good_blocks.length >= optimal_replicas) {
                        while (long_gone_blocks.length) {
                            push_block_to_remove(long_gone_blocks.pop(), 'extra long gone');
                        }
                    }

                    // remove good blocks only if above optimal
                    while (good_blocks.length > optimal_replicas) {
                        push_block_to_remove(good_blocks.pop(), 'extra good');
                    }

                    // for every build block pick a source from good blocks round robin
                    var round_rob = 0;
                    _.each(building_blocks, function(block) {
                        block.source = good_blocks[round_rob % good_blocks.length];
                        round_rob += 1;
                    });

                    // mark to allocate blocks for fragment to reach optimal count
                    var num_blocks_to_add =
                        Math.max(0, optimal_replicas - good_blocks.length - building_blocks.length);
                    _.times(num_blocks_to_add, function() {
                        blocks_info_to_allocate.push({
                            chunk_id: chunk._id,
                            chunk: chunk,
                            fragment: fragment,
                            source: good_blocks[round_rob % good_blocks.length]
                        });
                        round_rob += 1;
                    });
                });
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
                    var blocks_info_by_chunk = _.groupBy(blocks_info_to_allocate, 'chunk_id');
                    return Q.all(_.map(blocks_info_by_chunk, function(blocks_info) {
                            var chunk = blocks_info[0].chunk;
                            return block_allocator.allocate_blocks_for_chunk(chunk, blocks_info);
                        }))
                        .then(function(res) {

                            // append new blocks to build list
                            var new_blocks = _.flatten(res);
                            Array.prototype.push.apply(blocks_to_build, new_blocks);

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
            var sem = new Semaphore(32);

            dbg.log0('build_chunks:', 'replicating', blocks_to_build.length, 'blocks');
            return Q.all(_.map(blocks_to_build, function(block) {
                    return sem.surround(function() {
                        var agent = new api.agent_api.Client();
                        agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);
                        return agent.replicate_block({
                            block_id: block._id,
                            source: {
                                id: block.source._id,
                                node: {
                                    ip: block.source.node.ip,
                                    port: block.source.node.port,
                                }
                            }
                        }).thenResolve(block._id);
                    });
                }))
                .then(function(built_block_ids) {

                    // update building blocks to remove the building mode timestamp
                    return db.DataBlock.update({
                        _id: {
                            $in: built_block_ids
                        }
                    }, {
                        $unset: {
                            building: 1
                        }
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


setTimeout(build_worker, 5000);

function build_worker() {
    var last_chunk_id;
    var batch_size = 100;
    var time_since_last_build = 3000; // TODO increase...
    var building_timeout = 60000; // TODO increase...
    return run();

    function run() {
        return run_batch()
            .then(function() {
                return Q.delay(last_chunk_id ? 1000 : 10000);
            }, function(err) {
                dbg.log0('build_worker:', 'ERROR', err, err.stack);
                return Q.delay(10000);
            })
            .then(run);
    }

    function run_batch() {
        return Q.fcall(function() {
                var query = {
                    $and: [{
                        $or: [{
                            last_build: null
                        }, {
                            last_build: {
                                $lt: new Date(Date.now() - time_since_last_build)
                            }
                        }]
                    }, {
                        $or: [{
                            building: null
                        }, {
                            building: {
                                $lt: new Date(Date.now() - building_timeout)
                            }
                        }]
                    }]
                };
                if (last_chunk_id) {
                    query._id = {
                        $gt: last_chunk_id
                    };
                } else {
                    dbg.log0('build_worker:', 'BEGIN');
                }

                return db.DataChunk.find(query)
                    .limit(batch_size)
                    .exec();
            })
            .then(function(chunks) {

                // update the last_chunk_id for next time
                if (chunks.length === batch_size) {
                    last_chunk_id = chunks[chunks.length - 1];
                } else {
                    last_chunk_id = undefined;
                }

                if (chunks.length) {
                    return build_chunks(chunks);
                }
            });
    }
}






// UTILS //////////////////////////////////////////////////////////



/**
 *
 * load_chunk_fragments
 *
 */
function load_chunk_fragments(chunk_id) {
    return Q.when(db.DataBlock
            .find({
                chunk: chunk_id,
                deleted: null,
            })
            .populate('node')
            .exec())
        .then(function(blocks) {
            var fragments = _.groupBy(blocks, 'fragment');
            return fragments;
        });
}



function get_part_info(part, chunk, blocks, set_obj) {
    var fragments = [];
    _.each(_.groupBy(blocks, 'fragment'), function(fragment_blocks, fragment) {
        var sorted_blocks = _.sortBy(fragment_blocks, block_heartbeat_sort);
        fragments[fragment] = _.map(sorted_blocks, get_block_info);
    });
    var p = _.pick(part, 'start', 'end', 'chunk_offset');
    p.fragments = fragments;
    p.kfrag = chunk.kfrag;
    p.crypt = _.pick(chunk.crypt, 'hash_type', 'hash_val', 'cipher_type', 'cipher_val');
    p.chunk_size = chunk.size;
    p.chunk_offset = p.chunk_offset || 0;
    if (set_obj === 'set_obj') {
        p.obj = part.obj;
    }
    return p;
}

function get_block_info(block) {
    var b = _.pick(block, 'id');
    b.node = _.pick(block.node, 'ip', 'port');
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
function block_heartbeat_sort(block) {
    return -block.node.heartbeat.getTime();
}
