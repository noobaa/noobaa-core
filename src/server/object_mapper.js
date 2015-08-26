/* jshint node:true */
'use strict';

/**
 *
 * MAPPER
 *
 * object = file
 * part = part of a file logically, points to a chunk
 * chunk = actual data of the part can be used by several object parts if identical
 * block = representation of a chunk on a specific node
 * fragment = if we use erasure coding than a chunk is divided to fragments
 * where if we lose one we can rebuild it using the rest.
 * each fragment will be replicated to x nodes as blocks
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
    chunks_and_objects_count: chunks_and_objects_count
};

var _ = require('lodash');
var Q = require('q');
var db = require('./db');
var server_rpc = require('../server/server_rpc');
var range_utils = require('../util/range_utils');
var js_utils = require('../util/js_utils');
var promise_utils = require('../util/promise_utils');
var block_allocator = require('./block_allocator');
var Semaphore = require('noobaa-util/semaphore');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);

/**
 *
 * allocate_object_parts - allocates the object parts, chunks and blocks and writes it to the db
 *
 */
function allocate_object_parts(bucket, obj, parts) {
    var new_blocks = [];
    var new_chunks = [];
    var new_parts = [];
    var digest_to_dup_chunk;
    var existing_parts;
    var remove_parts;
    var query_parts_params = _.map(parts, get_part_key);
    dbg.log1('GGG allocate_object_parts: start');

    var reply = {
        parts: _.times(parts.length, function() {
            return {};
        })
    };

    return Q.all([

            // Check if some of the ObjectParts already exists from previous attempts
            Q.when(db.ObjectPart.find({
                    system: obj.system,
                    obj: obj.id,
                    $or: query_parts_params,
                    deleted: null
                })
                .populate('chunk')
                .exec()),

            // dedup with existing chunks by lookup of the digest of the data
            process.env.DEDUP_DISABLED !== 'true' &&
            Q.when(db.DataChunk.find({
                    system: obj.system,
                    digest_b64: {
                        $in: _.map(parts, function(part) {
                            return part.chunk.digest_b64;
                        })
                    },
                    deleted: null,
                })
                .exec())
        ])
        .spread(function(existing_parts_arg, dup_chunks) {
            existing_parts = existing_parts_arg;
            digest_to_dup_chunk = _.indexBy(dup_chunks, function(chunk) {
                return chunk.digest_b64;
            });
            // find blocks of the dup chunks
            var chunks_ids = _.uniq(
                _.map(digest_to_dup_chunk, '_id').concat(
                    _.map(existing_parts, function(part) {
                        return part.chunk._id;
                    })));
            return chunks_ids.length && Q.when(
                db.DataBlock.find({
                    chunk: {
                        $in: chunks_ids
                    },
                    deleted: null,
                })
                .populate('node')
                .exec());
        })
        .then(function(blocks) {

            // assign blocks to chunks
            var blocks_by_chunk_id = _.groupBy(blocks, 'chunk');
            _.each(digest_to_dup_chunk, function(chunk) {
                chunk.all_blocks = blocks_by_chunk_id[chunk._id];
                chunk.chunk_status = analyze_chunk_status(chunk, chunk.all_blocks);
            });
            remove_parts = _.remove(existing_parts, function(existing_part) {
                var chunk = existing_part.chunk;
                if (!chunk) {
                    return true; // remove it
                }
                chunk.all_blocks = blocks_by_chunk_id[chunk._id];
                chunk.chunk_status = analyze_chunk_status(chunk, chunk.all_blocks);
            });

            return Q.all(_.map(parts, function(part, i) {
                var reply_part = reply.parts[i];
                var existing_part = _.find(existing_parts, get_part_key(part));
                var dup_chunk = digest_to_dup_chunk[part.chunk.digest_b64];

                if (existing_part) {
                    // part already exists, probably from a previous attempt, use it
                    // and don't create a new part
                    dbg.log2('allocate_object_parts: found existing part, not allocating new',
                        part.start, part.end, part.part_sequence_number);
                    part.db_part = existing_part;
                    part.db_chunk = existing_part.chunk;
                } else {
                    // create a new part
                    dbg.log3('allocate_object_parts: no existing part, aclcoating new',
                        part.start, part.end, part.part_sequence_number);
                    if (dup_chunk) {
                        part.db_chunk = dup_chunk;
                    } else {
                        part.db_chunk = /*new db.DataChunk*/ (_.extend({
                            _id: db.new_object_id(),
                            system: obj.system,
                            building: new Date(),
                        }, part.chunk));
                        new_chunks.push(part.db_chunk);
                    }
                    part.db_part = /*new db.ObjectPart*/ ({
                        _id: db.new_object_id(),
                        system: obj.system,
                        obj: obj.id,
                        start: part.start,
                        end: part.end,
                        part_sequence_number: part.part_sequence_number,
                        upload_part_number: part.upload_part_number || 0,
                        chunk: part.db_chunk
                    });
                    new_parts.push(part.db_part);
                }

                // Verify chunk health
                if (part.db_chunk.chunk_status &&
                    part.db_chunk.chunk_status.chunk_health !== 'unavailable') {
                    // Chunk health is ok, we can mark it as dedup
                    dbg.log3('allocate_object_parts: chunk already available');
                    reply_part.dedup = true;
                    return;
                }

                // Chunk is not available, create a new fragment on it
                dbg.log2('allocate_object_parts: chunk is unavailable,',
                    'allocating new block for it', part.db_chunk);
                var avoid_nodes = _.map(part.db_chunk.all_blocks, function(block) {
                    return block.node._id.toString();
                });
                return Q.all(_.map(part.frags, function(fragment) {
                        return block_allocator.allocate_block(part.db_chunk, avoid_nodes)
                            .then(function(block) {
                                block.layer = fragment.layer;
                                block.frag = fragment.frag;
                                if (fragment.layer_n) {
                                    block.layer_n = fragment.layer_n;
                                }
                                block.digest_type = fragment.digest_type;
                                block.digest_b64 = fragment.digest_b64;
                                avoid_nodes.push(block.node._id.toString());
                                new_blocks.push(block);
                                return block;
                            });
                    }))
                    .then(function(new_blocks_of_chunk) {
                        dbg.log2('allocate_object_parts: part info', part,
                            'chunk', part.db_chunk,
                            'blocks', new_blocks_of_chunk);
                        reply_part.part = get_part_info({
                            part: part,
                            chunk: part.db_chunk,
                            blocks: new_blocks_of_chunk,
                            building: true
                        });
                    });
            }));
        })
        .then(function() {
            _.each(new_blocks, function(x) {
                // x = x.toObject();
                // x.system = x.system._id;
                // x.tier = x.tier._id;
                x.node = x.node._id;
                x.chunk = x.chunk._id;
            });
            _.each(new_chunks, function(x) {
                // x = x.toObject();
                // x.system = x.system._id;
                // x.tier = x.tier._id;
                // x.bucket = x.bucket._id;
            });
            _.each(new_parts, function(x) {
                // x = x.toObject();
                // x.system = x.system._id;
                x.obj = db.new_object_id(x.obj);
                x.chunk = x.chunk._id;
            });
            dbg.log2('allocate_object_parts: db create blocks', new_blocks);
            dbg.log2('allocate_object_parts: db create chunks', new_chunks);
            dbg.log2('allocate_object_parts: db remove parts', remove_parts);
            dbg.log2('allocate_object_parts: db create parts', new_parts);
            // we send blocks and chunks to DB in parallel,
            // even if we fail, it will be ignored until someday we reclaim it
            return Q.all([
                // new_blocks.length && db.DataBlock.create(new_blocks),
                new_blocks.length && Q.when(db.DataBlock.collection.insertMany(new_blocks)),
                // new_chunks.length && db.DataChunk.create(new_chunks),
                new_chunks.length && Q.when(db.DataChunk.collection.insertMany(new_chunks)),
                remove_parts.length && db.ObjectPart.update({
                    _id: {
                        $in: _.map(remove_parts, '_id')
                    }
                }, {
                    deleted: new Date()
                }, {
                    multi: true
                })
                .exec()
            ]);
        })
        .then(function() {
            // return new_parts.length && db.ObjectPart.create(new_parts);
            return new_parts.length && Q.when(db.ObjectPart.collection.insertMany(new_parts));
        })
        .then(function() {
            dbg.log2('allocate_object_parts: DONE. parts', parts.length);
            return reply;
        }, function(err) {
            dbg.error('allocate_object_parts: ERROR', err.stack || err);
            throw err;
        });
}


/**
 *
 * finalize_object_parts
 * after the 1st block was uploaded this creates more blocks on other nodes
 * to replicate to but only in the db.
 *
 */
function finalize_object_parts(bucket, obj, parts) {
    var chunks;
    var block_ids = _.flatten(_.compact(_.map(parts, 'block_ids')));
    var query_parts_params = _.map(parts, get_part_key);

    return Q.all([

            // find parts by start offset, deleted parts are handled later
            db.ObjectPart
            .find({
                obj: obj.id,
                $or: query_parts_params,
            })
            .populate('chunk')
            .exec(),

            // find blocks by list of ids, deleted blocks are handled later
            block_ids.length &&
            db.DataBlock.find({
                _id: {
                    $in: block_ids
                },
                // deleted blocks can occur due to report_bad_block,
                // so filter out and leave as trash
                deleted: null
            })
            .exec()
        ])
        .spread(function(parts_res, blocks) {
            var parts_by_start = _.groupBy(parts_res, 'start');
            chunks = _.flatten(_.map(parts, function(part) {
                if (part.deleted) {
                    // Part was deleted before we finalized the object, race with delete ?
                    dbg.warn("BUG? during finalize found part marked as deleted ", part);
                }
                var part_res = parts_by_start[part.start];
                if (!part_res) {
                    throw new Error('part not found for obj ' +
                        obj.id + ' ' + range_utils.human_range(part));
                }
                return _.map(part_res, function(p) {
                    return p.chunk;
                });
            }));
            var chunk_by_id = _.indexBy(chunks, '_id');
            _.each(blocks, function(block) {
                dbg.log3('going to finalize block ', block);
                if (!block.building) {
                    dbg.warn("ERROR block not in building mode ", block);
                    // for reentrancy we avoid failing if the building mode
                    //  was already unset, and just go ahead with calling build_chunks
                    // which will handle it all.
                    // throw new Error('block not in building mode');
                }
                var chunk = chunk_by_id[block.chunk];
                if (!chunk) {
                    throw new Error('missing block chunk for ' + block.chunk);
                }
            });

            dbg.log2("finalize_object_parts unset block building mode ", block_ids);
            return block_ids.length && db.DataBlock.collection.updateMany({
                _id: {
                    $in: _.map(block_ids, db.new_object_id)
                }
            }, {
                $unset: {
                    building: ''
                }
            }, {
                multi: true
            });
            // .exec();
        })
        .then(function() {
            // using a timeout to limit our wait here.
            // in case of failure to build, we suppress the error for the
            // sake of user experienceand leave it to the background worker.
            // TODO dont suppress build errors, fix them.
            return Q.fcall(function() {
                    return build_chunks(chunks);
                })
                .timeout(config.server_finalize_build_timeout, 'finalize build timeout')
                .then(null, function(err) {
                    dbg.error('finalize_object_parts: BUILD FAILED',
                        'leave it to background worker', err.stack || err);
                });
        })
        .then(function() {
            var end = parts[parts.length - 1].end;
            if (end > obj.upload_size) {
                return Q.when(db.ObjectMD.collection.updateOne({
                        _id: obj._id
                    }, {
                        $set: {
                            upload_size: end
                        }
                    })
                    // .exec()
                );
            }
        })
        .then(function() {
            dbg.log0('finalize_object_parts: DONE. parts', parts.length);
        }, function(err) {
            dbg.error('finalize_object_parts: ERROR', err.stack || err);
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
                .populate('chunk');
            if (params.skip) find.skip(params.skip);
            if (params.limit) find.limit(params.limit);
            return find.exec();
        })
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                adminfo: params.adminfo
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
    var objects = {};
    var parts_per_obj_id = {};

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
                    chunk: {
                        $in: _.map(blocks, 'chunk')
                    },
                    deleted: null,
                })
                .populate('chunk')
                .populate('obj')
                .exec();
        })
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                set_obj: true,
                adminfo: true
            });
        })
        .then(function(parts) {
            objects = {};
            parts_per_obj_id = _.groupBy(parts, function(part) {
                var obj = part.obj;
                delete part.obj;
                objects[obj.id] = obj;
                return obj.id;
            });

            return db.Bucket
                .find({
                    '_id': {
                        $in: _.uniq(_.map(objects, 'bucket'))
                    },
                    deleted: null,
                })
                .exec();
        }).then(function(buckets) {
            var buckets_by_id = _.indexBy(buckets, '_id');

            return _.map(objects, function(obj, obj_id) {

                return {
                    key: obj.key,
                    bucket: buckets_by_id[obj.bucket].name,
                    parts: parts_per_obj_id[obj_id]
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
 * @params: parts, set_obj, adminfo
 */
function read_parts_mappings(params) {
    var chunks = _.map(params.parts, 'chunk');
    var chunk_ids = _.pluck(chunks, 'id');

    // find all blocks of the resulting parts
    return Q.when(db.DataBlock
            .find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .sort('frag')
            .populate('node')
            .exec())
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            var parts_reply = _.map(params.parts, function(part) {
                var chunk = part.chunk;
                var blocks = blocks_by_chunk[chunk.id];
                return get_part_info({
                    part: part,
                    chunk: chunk,
                    blocks: blocks,
                    set_obj: params.set_obj,
                    adminfo: params.adminfo
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
            .populate('chunk')
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
            Q.fcall(function() {
                // find part that need update of start and end offsets
                return db.ObjectPart.find({
                        obj: obj,
                        deleted: null
                    })
                    .sort({
                        upload_part_number: 1,
                        part_sequence_number: 1,
                        _id: -1 // when same, get newest first
                    })
                    .exec();
            }),
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
            var last_end = 0;
            var last_upload_part_number = 0;
            var last_part_sequence_number = -1;
            if (last_stable_part[0]) {
                last_end = last_stable_part[0].end;
                last_upload_part_number = last_stable_part[0].upload_part_number;
                last_part_sequence_number = last_stable_part[0].part_sequence_number;
            }
            dbg.log1('fix_multipart_parts: found remaining_parts', remaining_parts);
            dbg.log1('fix_multipart_parts: found last_stable_part', last_stable_part);
            var bulk_update = db.ObjectPart.collection.initializeUnorderedBulkOp();
            _.each(remaining_parts, function(part) {
                var mismatch;
                var unneeded;
                if (part.upload_part_number === last_upload_part_number) {
                    if (part.part_sequence_number === last_part_sequence_number) {
                        unneeded = true;
                    } else if (part.part_sequence_number !== last_part_sequence_number + 1) {
                        mismatch = true;
                    }
                } else if (part.upload_part_number === last_upload_part_number + 1) {
                    if (part.part_sequence_number !== 0) {
                        mismatch = true;
                    }
                } else {
                    mismatch = true;
                }
                if (mismatch) {
                    dbg.error('fix_multipart_parts: MISMATCH UPLOAD_PART_NUMBER',
                        'last_upload_part_number', last_upload_part_number,
                        'last_part_sequence_number', last_part_sequence_number,
                        'part', part);
                    throw new Error('fix_multipart_parts: MISMATCH UPLOAD_PART_NUMBER');
                } else if (unneeded) {
                    bulk_update.find({
                        _id: part._id
                    }).removeOne();
                } else {
                    var current_end = last_end + part.end - part.start;
                    dbg.log1('fix_multipart_parts: update part range',
                        last_end, '-', current_end, part);
                    bulk_update.find({
                        _id: part._id
                    }).updateOne({
                        $set: {
                            start: last_end,
                            end: current_end,
                        },
                        $unset: {
                            upload_part_number: ''
                        }
                    });
                    last_end = current_end;
                    last_upload_part_number = part.upload_part_number;
                    last_part_sequence_number = part.part_sequence_number;
                }
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
        var block_md = get_block_md(del_blocks[0]);
        return server_rpc.client.agent.delete_blocks({
            blocks: _.map(del_blocks, function(block) {
                return block._id.toString();
            })
        }, {
            address: block_md.address,
            timeout: 30000,
        }).then(function() {
            dbg.log0('agent_delete_call: DONE. node', node, 'del_blocks', del_blocks);
        }, function(err) {
            dbg.log0('agent_delete_call: ERROR node', node, 'del_blocks', del_blocks);
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
            .populate('chunk')
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
                    chunk: {
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
            db.ObjectPart.findOne(_.extend({
                system: params.obj.system,
                obj: params.obj.id,
            }, _.pick(params,
                'start',
                'end',
                'upload_part_number',
                'part_sequence_number')))
            .populate('chunk')
            .exec(),
        ])
        .spread(function(bad_block, part) {
            if (!bad_block) {
                dbg.error('report_bad_block: block not found', params);
                throw new Error('report_bad_block: block not found');
            }
            if (!part) {
                dbg.error('report_bad_block: part not found', params);
                throw new Error('report_bad_block: part not found');
            }
            var chunk = part.chunk;
            if (!chunk || String(bad_block.chunk) !== String(chunk.id)) {
                dbg.error('report_bad_block: mismatching chunk for block', bad_block,
                    'and part', part, 'params', params);
                throw new Error('report_bad_block: mismatching chunk for block and part');
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
                        if (!new_block) {
                            throw new Error('report_bad_block: no nodes for allocation');
                        }
                        new_block.layer = bad_block.layer;
                        new_block.layer_n = bad_block.layer_n;
                        new_block.frag = bad_block.frag;
                        new_block.size = bad_block.size;
                        new_block.digest_type = bad_block.digest_type;
                        new_block.digest_b64 = bad_block.digest_b64;
                        return db.DataBlock.create(new_block);
                    })
                    .then(function() {
                        return block_allocator.remove_blocks([bad_block]);
                    })
                    .then(function() {
                        dbg.log0('report_bad_block: DONE. create new_block', new_block,
                            'params', params);
                        return get_block_md(new_block);
                    }, function(err) {
                        dbg.error('report_bad_block: ERROR params', params, err.stack || err);
                        throw err;
                    });

            } else {
                // TODO mark the block as bad for next reads and decide when to trigger rebuild
                dbg.log0('report_bad_block: TODO! is_read not yet doing anything');
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
    var had_errors = 0;
    var replicated_block_ids = [];
    var replicated_failed_ids = [];
    var chunk_ids = _.pluck(chunks, '_id');
    var chunk_ids_need_update_to_building = _.compact(_.map(chunks, function(chunk) {
        return chunk.building ? null : chunk._id;
    }));

    dbg.log1('build_chunks:', 'batch start', chunks.length, 'chunks');

    return Q.all([ // parallel queries

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
            chunks_status = _.map(chunks, function(chunk) {
                var chunk_blocks = blocks_by_chunk[chunk._id];
                var chunk_status = analyze_chunk_status(chunk, chunk_blocks);
                js_utils.array_push_all(blocks_to_remove, chunk_status.blocks_to_remove);
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
                dbg.log1('build_chunks: chunk', _.get(chunk_status, 'chunk._id'),
                    'all_blocks', _.get(chunk_status, 'all_blocks.length'),
                    'blocks_info_to_allocate', _.get(chunk_status, 'blocks_info_to_allocate.length'));
                return promise_utils.iterate(chunk_status.blocks_info_to_allocate,
                    function(block_info_to_allocate) {
                        return block_allocator.allocate_block(block_info_to_allocate.chunk, avoid_nodes)
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

            return Q.allSettled(_.map(chunks_status, function(chunk_status) {
                return Q.allSettled(_.map(chunk_status.blocks_info_to_allocate,
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

            return Q.all([
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

/**
 *
 * chunks_and_objects_count
 *
 */
function chunks_and_objects_count(systemid) {
    var res = {
        chunks_num: 0,
        objects_num: 0,
    };

    return Q.when(
            db.DataChunk.count({
                system: systemid,
                deleted: null,
            })
            .exec())
        .then(function(chunks) {
            res.chunks_num = chunks;
            return Q.when(
                    db.ObjectPart.count({

                    })
                    .exec())
                .then(function(objects) {
                    res.objects_num = objects;
                    return res;
                });
        });
}

/**
 *
 * BUILD_CHUNKS_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 */
if (process.env.BUILD_WORKER_DISABLED !== 'true') {
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
                    dbg.error('BUILD_WORKER:', 'ERROR', err, err.stack);
                    return 10000;
                });
        }
    });
}




// UTILS //////////////////////////////////////////////////////////




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
    var blocks_by_frag_key = _.groupBy(all_blocks, get_frag_key);
    var blocks_info_to_allocate;
    var blocks_to_remove;
    var chunk_health = 'available';

    // TODO loop over parity fragments too
    var frags = _.times(chunk.data_frags, function(frag) {

        var fragment = {
            layer: 'D',
            frag: frag,
        };

        fragment.blocks = blocks_by_frag_key[get_frag_key(fragment)] || [];

        // sorting the blocks by last node heartbeat time and by srvmode and building,
        // so that reading will be served by most available node.
        // TODO better randomize order of blocks for some time frame
        // TODO need stable sorting here for parallel decision making...
        fragment.blocks.sort(block_access_sort);

        dbg.log1('analyze_chunk_status:', 'chunk', chunk._id,
            'fragment', frag, 'num blocks', fragment.blocks.length);

        _.each(fragment.blocks, function(block) {
            var since_hb = now - block.node.heartbeat.getTime();
            if (since_hb > config.LONG_GONE_THRESHOLD || block.node.srvmode === 'disabled') {
                return js_utils.named_array_push(fragment, 'long_gone_blocks', block);
            }
            if (since_hb > config.SHORT_GONE_THRESHOLD) {
                return js_utils.named_array_push(fragment, 'short_gone_blocks', block);
            }
            if (block.building) {
                var since_bld = now - block.building.getTime();
                if (since_bld > config.LONG_BUILD_THRESHOLD) {
                    return js_utils.named_array_push(fragment, 'long_building_blocks', block);
                } else {
                    return js_utils.named_array_push(fragment, 'building_blocks', block);
                }
            }
            if (!block.node.srvmode) {
                js_utils.named_array_push(fragment, 'good_blocks', block);
            }
            // also keep list of blocks that we can use to replicate from
            if (!block.node.srvmode || block.node.srvmode === 'decommissioning') {
                js_utils.named_array_push(fragment, 'accessible_blocks', block);
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

        if (num_good_blocks > config.OPTIMAL_REPLICAS) {
            blocks_to_remove = blocks_to_remove || [];

            // remove all blocks that were building for too long
            // as they most likely failed to build.
            js_utils.array_push_all(blocks_to_remove, fragment.long_building_blocks);

            // remove all long gone blocks
            // defer the short gone blocks until either back to good or become long.
            js_utils.array_push_all(blocks_to_remove, fragment.long_gone_blocks);

            // remove extra good blocks when good blocks are above optimal
            // and not just accesible blocks are above optimal
            js_utils.array_push_all(blocks_to_remove, fragment.good_blocks.slice(config.OPTIMAL_REPLICAS));
        }

        if (num_good_blocks < config.OPTIMAL_REPLICAS && num_accessible_blocks) {
            fragment.health = 'repairing';

            // will allocate blocks for fragment to reach optimal count
            blocks_info_to_allocate = blocks_info_to_allocate || [];
            var round_rob = 0;
            var num_blocks_to_add = Math.max(0, config.OPTIMAL_REPLICAS - num_good_blocks);
            _.times(num_blocks_to_add, function() {
                blocks_info_to_allocate.push({
                    system_id: chunk.system,
                    tier_id: chunk.tier,
                    chunk_id: chunk._id,
                    chunk: chunk,
                    layer: 'D',
                    frag: frag,
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
        frags: frags,
        blocks_info_to_allocate: blocks_info_to_allocate,
        blocks_to_remove: blocks_to_remove,
        chunk_health: chunk_health,
    };
}




function get_part_info(params) {
    var chunk_status = analyze_chunk_status(params.chunk, params.blocks);
    var p = _.pick(params.part, 'start', 'end');

    p.chunk = _.pick(params.chunk,
        'size',
        'digest_type',
        'digest_b64',
        'compress_type',
        'compress_size',
        'cipher_type',
        'cipher_key_b64',
        'cipher_iv_b64',
        'cipher_auth_tag_b64',
        'data_frags',
        'lrc_frags');
    if (params.adminfo) {
        p.chunk.adminfo = {
            health: chunk_status.chunk_health
        };
    }
    p.part_sequence_number = params.part.part_sequence_number;
    if (params.upload_part_number) {
        p.upload_part_number = params.upload_part_number;
    }
    if (params.set_obj) {
        p.obj = params.part.obj;
    }
    if (params.part.chunk_offset) {
        p.chunk_offset = params.part.chunk_offset;
    }

    p.frags = _.map(chunk_status.frags, function(fragment) {
        var blocks = params.building && fragment.building_blocks ||
            params.adminfo && fragment.blocks ||
            fragment.accessible_blocks;

        var part_fragment = _.pick(fragment, 'layer', 'layer_n', 'frag');

        // take the digest from some block.
        // TODO better check that the rest of the blocks match...
        if (fragment.blocks[0]) {
            part_fragment.digest_type = fragment.blocks[0].digest_type;
            part_fragment.digest_b64 = fragment.blocks[0].digest_b64;
        } else {
            part_fragment.digest_type = '';
            part_fragment.digest_b64 = '';
        }

        if (params.adminfo) {
            part_fragment.adminfo = {
                health: fragment.health,
            };
        }

        part_fragment.blocks = _.map(blocks, function(block) {
            var ret = {
                block_md: get_block_md(block),
            };
            var node = block.node;
            if (params.adminfo) {
                var adminfo = {
                    tier_name: 'nodes', // TODO get tier name
                    node_name: node.name,
                    node_ip: node.ip,
                    online: node.is_online(),
                };
                if (node.srvmode) {
                    adminfo.srvmode = node.srvmode;
                }
                if (block.building) {
                    adminfo.building = true;
                }
                ret.adminfo = adminfo;
            }
            return ret;
        });
        return part_fragment;
    });

    return p;
}


function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = block._id.toString();
    b.address = block.node.get_rpc_address();
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

function get_frag_key(f) {
    return f.layer + '-' + f.frag;
}

function get_part_key(part) {
    return _.pick(part, 'start', 'end', 'upload_part_number', 'part_sequence_number');
}
