/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var jwt = require('jsonwebtoken');
var db = require('./db');
var api = require('../api');
var range_utils = require('../util/range_utils');
var block_allocator = require('./block_allocator');
var node_monitor = require('./node_monitor');
var Semaphore = require('noobaa-util/semaphore');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');


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
    var new_parts = [];

    var reply = {
        parts: _.times(parts.length, function() {
            return {};
        })
    };

    // dedup with existing chunks by lookup of crypt.hash_val
    return Q.when(
            db.DataChunk
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
            .exec())
        .then(function(dup_chunks) {
            var hash_val_to_dup_chunk = _.indexBy(dup_chunks, function(chunk) {
                return chunk.crypt.hash_val;
            });
            _.each(parts, function(part, i) {
                // chunk size is aligned up to be an integer multiple of kfrag*block_size
                var chunk_size = range_utils.align_up_bitwise(part.chunk_size, CHUNK_KFRAG_BITWISE);
                var dup_chunk = hash_val_to_dup_chunk[part.crypt.hash_val];
                var chunk;
                if (config.doDedup && dup_chunk) {
                    chunk = dup_chunk;
                    reply.parts[i].dedup = true;
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
                _.map(new_chunks, function(chunk) {
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
                if (config.doDedup && reply_part.dedup) return;
                var new_blocks = blocks_by_chunk[part.chunks[0].chunk];
                var chunk = new_blocks[0].chunk;
                dbg.log0('part info', part,
                    'chunk', chunk,
                    'blocks', new_blocks);
                reply_part.part = get_part_info(part, chunk, new_blocks);
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
            db.DataBlock
            .find({
                _id: {
                    $in: block_ids
                }
            })
            .exec()
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
                dbg.log3('going to finalize block ',block);
                if (!block.building) {
                    throw new Error('block not in building mode');
                }
                var chunk = chunk_by_id[block.chunk];
                if (!chunk) {
                    throw new Error('missing block chunk');
                }
            });
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
        })
        .then(function() {
            return build_chunks(chunks);
        }).then(null, function(err) {
            console.error('error finalize_object_parts '+err+' ; '+err.stack);
            throw err;
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
                    var accessible_blocks = [];
                    var short_gone_blocks = [];
                    var long_gone_blocks = [];
                    var building_blocks = [];
                    var building_timeout_blocks = [];


                    _.each(blocks, function(block) {
                        var since_hb = now - block.node.heartbeat.getTime();
                        if (since_hb > long_gone_threshold || block.node.srvmode === 'blocked') {
                            return long_gone_blocks.push(block);
                        }
                        if (since_hb > short_gone_threshold) {
                            return short_gone_blocks.push(block);
                        }
                        if (block.building) {
                            var since_bld = now - block.building.getTime();
                            if (since_bld > long_build_threshold) {
                                return building_timeout_blocks.push(block);
                            } else {
                                return building_blocks.push(block);
                            }
                        }
                        if (!block.node.srvmode) {
                            good_blocks.push(block);
                        }
                        // also keep list of blocks that we can use to replicate from
                        if (!block.node.srvmode || block.node.srvmode === 'decommissioning') {
                            accessible_blocks.push(block);
                        }
                    });

                    if (!accessible_blocks.length) {
                        // TODO try erasure coding to rebuild from other fragments
                        console.error('build_chunk:', 'NO ACCESSIBLE BLOCKS',
                            'chunk', chunk._id, 'fragment', fragment,
                            'good', good_blocks.length,
                            'accessible', accessible_blocks.length,
                            'short gone', short_gone_blocks.length,
                            'long gone', long_gone_blocks.length,
                            'building', building_blocks.length,
                            'building timeout', building_timeout_blocks.length);
                        return;
                    }

                    // remove all blocks that were building for too long
                    // as they most likely failed to build
                    while (building_timeout_blocks.length) {
                        push_block_to_remove(chunk, fragment,
                            building_timeout_blocks.pop(), 'building timeout');
                    }

                    // when above optimal we can remove long gone blocks
                    // defer the short gone blocks until either back to good or become long.
                    if (good_blocks.length >= optimal_replicas) {
                        while (long_gone_blocks.length) {
                            push_block_to_remove(chunk, fragment,
                                long_gone_blocks.pop(), 'extra long gone');
                        }
                    }

                    // remove good blocks only if above optimal
                    while (good_blocks.length > optimal_replicas) {
                        push_block_to_remove(chunk, fragment,
                            good_blocks.pop(), 'extra good');
                    }

                    // mark to allocate blocks for fragment to reach optimal count
                    var round_rob = 0;
                    var num_blocks_to_add = Math.max(0, optimal_replicas - good_blocks.length);
                    _.times(num_blocks_to_add, function() {
                        blocks_info_to_allocate.push({
                            system_id: chunk.system,
                            tier_id: chunk.tier,
                            chunk_id: chunk._id,
                            chunk: chunk,
                            fragment: fragment,
                            source: accessible_blocks[round_rob % accessible_blocks.length]
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
                        //agent.options.set_p2p_context(self.p2p_context); TODO

                        return agent.replicate_block({
                            block_id: block._id.toString(),
                            source: source_addr
                        }).then(function() {
                            dbg.log3('replicated block', block._id);
                        }, function(err) {
                            dbg.log0('ERROR replicate block', block._id, block_addr.host, err);
                            throw err;
                        })
                            .thenResolve(block._id);
                    });
                }))
                .then(function(built_block_ids) {
                    dbg.log3('replicated blocks', built_block_ids);

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


setTimeout(build_worker, 5000);

function build_worker() {

    if (!(config.buildWorkerOn)) return;

    var last_chunk_id;
    var batch_size = 100;
    var time_since_last_build = 3000; // TODO increase...
    var building_timeout = 60000; // TODO increase...
    return run();

    function run() {
        return run_batch()
            .then(function() {
                return Q.delay(last_chunk_id ? 1000 : 60000);
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
        fragments[fragment] = _.map(sorted_blocks, function(block) {
            var block_info = {
                address: get_block_address(block),
            };
            // TODO send details only to admin!
            block_info.details = {
                tier_name: 'devices', // TODO get tier name
                node_name: block.node.name,
                online: node_monitor.is_node_online(block.node),
            };
            if (block.node.srvmode) {
                block_info.details.srvmode = block.node.srvmode;
            }
            if (block.building) {
                block_info.details.building = true;
            }
            return block_info;
        });
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

function get_block_address(block) {
    var b = {};
    b.id = block._id.toString();
    b.host = 'http://' + block.node.ip + ':' + block.node.port;

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
function block_heartbeat_sort(block) {
    return -block.node.heartbeat.getTime();
}
