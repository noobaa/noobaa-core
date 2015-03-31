/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var jwt = require('jsonwebtoken');
var db = require('./db');
var api = require('../api');
var api_servers = require('../server/api_servers');
var range_utils = require('../util/range_utils');
var promise_utils = require('../util/promise_utils');
var block_allocator = require('./block_allocator');
var Semaphore = require('noobaa-util/semaphore');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);


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
    list_multipart_parts: list_multipart_parts,
    fix_multipart_parts: fix_multipart_parts,
    delete_object_mappings: delete_object_mappings,
    report_bad_block: report_bad_block,
    build_chunks: build_chunks,
    self_test_to_node_via_web: self_test_to_node_via_web
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
    var unavail_dup_chunks = [];
    var new_parts = [];
    var new_blocks_info = [];

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
                    _.each(hash_val_to_dup_chunk, function(chunk, hash_val) {
                        chunk.all_blocks = blocks_by_chunk_id[chunk._id];
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
                    var dup_chunk_status = analyze_chunk_status(dup_chunk, dup_chunk.all_blocks);

                    if (dup_chunk_status.chunk_health !== 'unavailable') {
                        //Chunk health is ok, we can mark it as dedup
                        dbg.log3('chunk is dupped and available', dup_chunk);
                        reply.parts[i].dedup = true;
                    } else {
                        //Chunk is not healthy, create a new fragment on it
                        dbg.log2('chunk is dupped but unavailable, allocating new blocks for it', dup_chunk);
                        unavail_dup_chunks.push(chunk);
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
                    upload_part_number: part.upload_part_number || 0,
                    chunks: [{
                        chunk: chunk,
                        // chunk_offset: 0, // not required
                    }]
                }));
            });
            dbg.log2('allocate_blocks');

            // Allocate both for the new chunks, and the unavailable dupped chunks
            var chunks_for_alloc = new_chunks.concat(unavail_dup_chunks);
            return promise_utils.iterate(chunks_for_alloc, function(chunk) {
                var avoid_nodes = _.map(chunk.all_blocks, function(block) {
                    return block.node._id.toString();
                });
                return block_allocator.allocate_block(chunk, avoid_nodes);
            });
        })
        .then(function(new_blocks) {
            var blocks_by_chunk = _.groupBy(new_blocks, function(block) {
                return block.chunk._id;
            });
            _.each(new_parts, function(part, i) {
                var reply_part = reply.parts[i];
                if (reply_part.dedup) return;
                var new_blocks_of_chunk = blocks_by_chunk[part.chunks[0].chunk];
                var chunk = new_blocks_of_chunk[0].chunk;
                dbg.log0('part info', part,
                    'chunk', chunk,
                    'blocks', new_blocks_of_chunk);
                reply_part.part = get_part_info({
                    part: part,
                    chunk: chunk,
                    blocks: new_blocks_of_chunk,
                    building: true
                });
            });
            dbg.log2('create blocks', new_blocks.length);
            dbg.log2('create chunks', new_chunks);
            // we send blocks and chunks to DB in parallel,
            // even if we fail, it will be ignored until someday we reclaim it
            return Q.all([
                db.DataBlock.create(new_blocks),
                db.DataChunk.create(new_chunks),
            ]);
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
    dbg.log0('finalize_object_parts', parts);
    var chunks;
    return Q.all([

            // find parts by start offset, deleted parts are handled later
            db.ObjectPart
            .find({
                obj: obj.id,
                start: {
                    $in: _.map(parts, 'start')
                }
            })
            .populate('chunks.chunk')
            .exec(),

            // find blocks by list of ids, deleted blocks are handled later
            (block_ids.length ?
                db.DataBlock
                .find({
                    _id: {
                        $in: block_ids
                    },
                })
                .exec() : null
            )
        ])
        .spread(function(parts_res, blocks) {
            var blocks_by_id = _.indexBy(blocks, '_id');
            var parts_by_start = _.groupBy(parts_res, 'start');
            chunks = _.flatten(_.map(parts, function(part) {
                if (part.deleted) {
                    //Part was deleted before we finalized the object, race with delete ?
                    dbg.log0("BUG? during finalize found part marked as deleted ", part);
                }
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
                if (block.deleted) {
                    //Block was deleted before we finalized the object, race with delete ?
                    dbg.log0("BUG? during finalize found block marked as deleted ", block);
                }
                dbg.log3('going to finalize block ', block);
                if (!block.building) {
                    dbg.log0("ERROR block not in building mode ", block);
                    // for reentrancy we avoid failing if the building mode
                    //  was already unset, and just go ahead with calling build_chunks
                    // which will handle it all.
                    // throw new Error('block not in building mode');
                }
                var chunk = chunk_by_id[block.chunk];
                if (!chunk) {
                    throw new Error('missing block chunk');
                }
            });

            if (block_ids.length) {
                dbg.log0("finalize_object_parts unset block building mode ", block_ids);
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
            return build_chunks(chunks);
        })
        .then(function() {
            var end = parts[parts.length - 1].end;
            if (end > obj.upload_size) {
                return Q.when(obj.update({
                    upload_size: end
                }).exec());
            }
        })
        .thenResolve()
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
                    deleted: null,
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
                    },
                    deleted: null,
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
 * list_multipart_parts
 *
 */
function list_multipart_parts(params) {
    var max_parts = Math.min(params.max_parts || 50, 50);
    var marker = params.part_number_marker || 0;
    return Q.when(db.ObjectPart.find({
                obj: params.obj.id,
                upload_part_number: {
                    $gte: marker,
                    $lt: marker + max_parts
                },
                deleted: null,
            })
            .sort('upload_part_number')
            // TODO set .limit(max_parts?)
            .populate('chunks.chunk')
            .exec())
        .then(function(parts) {
            var upload_parts = _.groupBy(parts, 'upload_part_number');
            dbg.log0('list_multipart_parts: upload_parts', upload_parts);
            var part_numbers = _.keys(upload_parts).sort();
            dbg.log0('list_multipart_parts: part_numbers', part_numbers);
            var last_part = parseInt(_.last(part_numbers), 10) || marker;
            return {
                part_number_marker: marker,
                max_parts: max_parts,
                // since we don't know here the real end number
                // then we just reply truncated=true until we get to the last iteration
                // where we don't find any parts.
                // TODO this logic fails if there is a gap of numbers. need to correct
                is_truncated: !!(part_numbers.length || !max_parts),
                next_part_number_marker: last_part + 1,
                upload_parts: _.map(part_numbers, function(num) {
                    return {
                        part_number: parseInt(num, 10),
                        size: _.reduce(upload_parts[num], function(sum, part) {
                            return sum + part.end - part.start;
                        }, 0)
                    };
                })
            };
        });
}



/**
 *
 * fix_multipart_parts
 *
 */
function fix_multipart_parts(obj) {
    return Q.all([
            // find part that need update of start and end offsets
            db.ObjectPart.find({
                obj: obj,
                deleted: null
            })
            .sort({
                upload_part_number: 1,
                start: 1
            })
            .exec(),
            // query to find the last part without upload_part_number
            // which has largest end offset.
            db.ObjectPart.find({
                obj: obj,
                upload_part_number: null,
                deleted: null
            })
            .sort({
                end: -1
            })
            .limit(1)
            .exec()
        ])
        .spread(function(remaining_parts, last_stable_part) {
            var last_end = last_stable_part[0] ? last_stable_part[0].end : 0;
            dbg.log0('complete_multipart_upload: found last_stable_part',last_stable_part);
            dbg.log0('complete_multipart_upload: found remaining_parts',remaining_parts);
            var bulk_update = db.ObjectPart.collection.initializeUnorderedBulkOp();
            _.each(remaining_parts, function(part) {
                var current_end = last_end + part.end - part.start;
                dbg.log0('complete_multipart_upload: update part range',
                    last_end, '-',current_end, part);
                bulk_update.find({
                    _id: part._id
                }).updateOne({
                    $set: {
                        start: last_end,
                        end: current_end,
                    },
                    $unset: {
                        upload_part_number: 1
                    }
                });
                last_end = current_end;
            });
            // calling execute on bulk and handling node callbacks
            return Q.ninvoke(bulk_update, 'execute').thenResolve(last_end);
        });
}



/*
 * agent_delete_call
 * calls the agent with the delete API
 */
function agent_delete_call(node, del_blocks) {
    return Q.fcall(function() {
        var block_addr = get_block_address(del_blocks[0]);
        return api_servers.client.agent.delete_blocks({
            blocks: _.map(del_blocks, function(block) {
                return block._id.toString();
            })
        }, {
            address: block_addr.host,
            domain: block_addr.peer,
            peer: block_addr.peer,
            is_ws: true,
            timeout: 30000,
        }).then(function() {
            dbg.log0("nodeId ", node, "deleted", del_blocks);
        }, function(err) {
            dbg.log0("ERROR deleting blocks", del_blocks, "from nodeId", node);
        });
    });
}

/*
 * delete_objects_from_agents
 * send delete request for the deleted DataBlocks to the agents
 */
function delete_objects_from_agents(deleted_chunk_ids) {
    //Find the deleted data blocks and their nodes
    Q.when(db.DataBlock
            .find({
                chunk: {
                    $in: deleted_chunk_ids
                },
                //For now, query deleted as well as this gets executed in
                //delete_object_mappings with Q.all along with the DataBlocks
                //deletion update
            })
            .populate('node')
            .exec())
        .then(function(deleted_blocks) {
            //TODO: If the overload of these calls is too big, we should protect
            //ourselves in a similar manner to the replication
            var blocks_by_node = _.groupBy(deleted_blocks, function(b) {
                return b.node._id;
            });

            return Q.all(_.map(blocks_by_node, function(blocks, node) {
                return agent_delete_call(node, blocks);
            }));
        });
}

/**
 *
 * delete_object_mappings
 *
 */
function delete_object_mappings(obj) {
    // find parts intersecting the [start,end) range
    var deleted_parts;
    var all_chunk_ids;
    return Q.when(db.ObjectPart
            .find({
                obj: obj.id,
                deleted: null,
            })
            .populate('chunks.chunk')
            .exec())
        .then(function(parts) {
            deleted_parts = parts;
            //Mark parts as deleted
            var in_object_parts = {
                _id: {
                    $in: _.pluck(parts, '_id')
                }
            };
            var deleted_update = {
                deleted: new Date()
            };
            var multi_opt = {
                multi: true
            };
            return db.ObjectPart.update(in_object_parts, deleted_update, multi_opt).exec();
        })
        .then(function() {
            var chunks = _.pluck(_.flatten(
                    _.map(deleted_parts, 'chunks')),
                'chunk');
            all_chunk_ids = _.pluck(chunks, '_id');
            //For every chunk, verify if its no longer referenced
            return db.ObjectPart
                .find({
                    'chunks.chunk': {
                        $in: all_chunk_ids
                    },
                    deleted: null,
                })
                .exec();
        })
        .then(function(referring_parts) {
            //Seperate non referred chunks
            var referred_chunks_ids = _.pluck(_.flatten(
                    _.map(referring_parts, 'chunks')),
                'chunk');
            var non_referred_chunks_ids = db.obj_ids_difference(
                all_chunk_ids, referred_chunks_ids);
            dbg.log4("all object's chunk ids are", all_chunk_ids,
                "non referenced chunk ids are", non_referred_chunks_ids);
            //Update non reffered chunks and their blocks as deleted
            var in_chunk_ids = {
                $in: non_referred_chunks_ids
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
                db.DataBlock.update(block_query, deleted_update, multi_opt).exec(),
                delete_objects_from_agents(non_referred_chunks_ids),
            ]);
        });
}



/**
 *
 * report_bad_block
 *
 * @params: obj, start, end, fragment, block_id, is_write
 *
 */
function report_bad_block(params) {
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
        .spread(function(bad_block, part) {
            if (!part || !part.chunks || !part.chunks[0] || !part.chunks[0].chunk) {
                console.error('bad block - invalid part/chunk', bad_block, part);
                throw new Error('invalid bad block request');
            }
            var chunk = part.chunks[0].chunk;
            if (!bad_block || bad_block.fragment !== params.fragment ||
                String(bad_block.chunk) !== String(chunk.id)) {
                console.error('bad block - invalid block', bad_block, part);
                throw new Error('invalid bad block request');
            }

            if (params.is_write) {
                var new_block;

                return Q.when(
                        db.DataBlock.find({
                            chunk: chunk,
                            deleted: null,
                        })
                        .populate('node')
                        .exec())
                    .then(function(all_blocks) {
                        var avoid_nodes = _.map(all_blocks, function(block) {
                            return block.node._id.toString();
                        });
                        return block_allocator.allocate_block(chunk, avoid_nodes);
                    })
                    .then(function(new_block_arg) {
                        new_block = new_block_arg;
                        new_block.fragment = params.fragment;
                        return db.DataBlock.create(new_block);
                    })
                    .then(function() {
                        return block_allocator.remove_blocks([bad_block]);
                    })
                    .then(function() {
                        return get_block_address(new_block);
                    });

            } else {
                // TODO mark the block as bad for next reads and decide when to trigger rebuild
            }

        });
}

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
    var num_replicate_errors = 0;
    var replicated_block_ids = [];
    var chunk_ids = _.pluck(chunks, '_id');
    var in_chunk_ids = {
        $in: chunk_ids
    };

    dbg.log0('build_chunks:', 'batch start', chunks.length, 'chunks');

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

            // analyze chunks

            var blocks_by_chunk = _.groupBy(all_blocks, 'chunk');
            var blocks_to_remove = [];
            chunks_status = _.map(chunks, function(chunk) {
                var chunk_blocks = blocks_by_chunk[chunk._id];
                var chunk_status = analyze_chunk_status(chunk, chunk_blocks);
                array_push_all(blocks_to_remove, chunk_status.blocks_to_remove);
                return chunk_status;
            });

            // remove blocks -
            // submit this to run in parallel while doing the longer allocate path.
            // and will wait for it below before returning.

            if (blocks_to_remove.length) {
                dbg.log0('build_chunks: removing blocks', blocks_to_remove.length);
                remove_blocks_promise = block_allocator.remove_blocks(blocks_to_remove);
            }

            // allocate blocks

            return promise_utils.iterate(chunks_status, function(chunk_status) {
                var avoid_nodes = _.map(chunk_status.all_blocks, function(block) {
                    return block.node._id.toString();
                });
                var blocks_info = chunk_status.blocks_info_to_allocate;
                return promise_utils.iterate(blocks_info, function(block_info) {
                    return block_allocator.allocate_block(block_info.chunk, avoid_nodes)
                        .then(function(new_block) {
                            block_info.block = new_block;
                            avoid_nodes.push(new_block.node._id.toString());
                            return new_block;
                        });
                });
            });

        })
        .then(function(new_blocks) {

            // create blocks in db (in building mode)

            if (!new_blocks || !new_blocks.length) return;
            new_blocks = _.flatten(new_blocks);
            dbg.log0('build_chunks: creating blocks', new_blocks);
            return db.DataBlock.create(new_blocks);

        })
        .then(function() {

            // replicate blocks
            // send to the agent a request to replicate from the source

            return Q.allSettled(_.map(chunks_status, function(chunk_status) {
                var blocks_info = chunk_status.blocks_info_to_allocate;
                return Q.allSettled(_.map(blocks_info, function(block_info) {
                    var block = block_info.block;
                    var block_addr = get_block_address(block);
                    var source_addr = get_block_address(block_info.source);

                    return replicate_block_sem.surround(function() {
                        return api_servers.client.agent.replicate_block({
                            block_id: block._id.toString(),
                            source: source_addr
                        }, {
                            address: block_addr.host,
                            domain: block_addr.peer,
                            peer: block_addr.peer,
                            is_ws: true,
                            timeout: config.server_replicate_timeout,
                        });
                    }).then(function() {
                        dbg.log1('build_chunks replicated block', block._id,
                            'to', block_addr.peer, 'from', source_addr.peer);
                        replicated_block_ids.push(block._id);
                    }, function(err) {
                        dbg.log0('build_chunks FAILED replicate block', block._id,
                            'to', block_addr.peer, 'from', source_addr.peer,
                            err.stack || err);
                        block_info.replicate_error = err;
                        chunk_status.replicate_error = err;
                        num_replicate_errors += 1;
                        // don't fail here yet to allow handling the successful blocks
                        // so just keep the error, and we will fail at the end of build_chunks
                    });
                }));
            }));

        })
        .then(function() {

            // update building blocks to remove the building mode timestamp

            dbg.log0("build_chunks unset block building mode ", replicated_block_ids);
            return db.DataBlock.update({
                _id: {
                    $in: replicated_block_ids
                }
            }, {
                $unset: {
                    building: 1
                }
            }, {
                multi: true
            }).exec();

        })
        .then(function() {

            // wait for blocks to be removed here before finishing
            return remove_blocks_promise;

        })
        .then(function() {

            // success chunks - remove the building time and set last_build time

            var success_chunks_status = _.reject(chunks_status, 'replicate_error');
            if (!success_chunks_status.length) return;
            var success_chunk_ids = _.map(success_chunks_status, function(chunk_status) {
                return chunk_status.chunk._id;
            });
            dbg.log0('build_chunks: success chunks', success_chunk_ids.length);
            return db.DataChunk.update({
                _id: {
                    $in: success_chunk_ids
                }
            }, {
                last_build: new Date(),
                $unset: {
                    building: 1
                }
            }, {
                multi: true
            }).exec();

        })
        .then(function() {

            // failed chunks - remove only the building time
            // but leave last_build so that worker will retry

            var failed_chunks_status = _.filter(chunks_status, 'replicate_error');
            if (!failed_chunks_status.length) return;
            var failed_chunk_ids = _.map(failed_chunks_status, function(chunk_status) {
                return chunk_status.chunk._id;
            });
            dbg.log0('build_chunks: failed chunks', failed_chunk_ids.length);
            return db.DataChunk.update({
                _id: {
                    $in: failed_chunk_ids
                }
            }, {
                $unset: {
                    building: 1
                }
            }, {
                multi: true
            }).exec();

        })
        .then(function() {

            // return error from the promise if any replication failed,
            // so that caller will know the build isn't really complete
            if (num_replicate_errors) {
                throw new Error('build_chunks failed to replicate all required blocks');
            }

        });
}


/**
 *
 * self_test_to_node_via_web
 *
 */
function self_test_to_node_via_web(req) {
    console.log(require('util').inspect(req));

    var target = req.rpc_params.target;
    var source = req.rpc_params.source;

    console.log('SELF TEST', target.peer, 'from', source.peer);

    return api_servers.client.agent.self_test_peer({
        target: {
            id: target.id,
            host: target.host,
            peer: target.peer
        },
        request_length: req.rpc_params.request_length || 1024,
        response_length: req.rpc_params.response_length || 1024,
    }, {
        address: source.host,
        domain: source.peer,
        peer: source.peer,
        is_ws: true,
        retries: 3,
        timeout: 30000
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
                    query.deleted = null;

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
    var chunk_health = 'available';

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
            chunk_health = 'unavailable';
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
        chunk: chunk,
        all_blocks: all_blocks,
        fragments: fragments,
        blocks_info_to_allocate: blocks_info_to_allocate,
        blocks_to_remove: blocks_to_remove,
        chunk_health: chunk_health,
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
    if (params.upload_part_number) {
        p.upload_part_number = params.upload_part_number;
    }
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
