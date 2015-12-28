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
    calc_multipart_md5: calc_multipart_md5,
    set_multipart_part_md5: set_multipart_part_md5,
    delete_object_mappings: delete_object_mappings,
    report_bad_block: report_bad_block,
    chunks_and_objects_count: chunks_and_objects_count

};

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var server_rpc = require('./server_rpc').server_rpc;
var object_utils = require('./utils/object_mapper_utils');
var policy_allocation = require('./utils/policy_allocation');
var range_utils = require('../util/range_utils');
var string_utils = require('../util/string_utils');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');
var crypto = require('crypto');
var time_utils = require('../util/time_utils');


/**
 *
 * allocate_object_parts - allocates the object parts, chunks and blocks and writes it to the db
 *
 */
function allocate_object_parts(bucket, obj, parts) {
    var find_result = {};
    var call_alloc_result = {};

    dbg.log1('allocate_object_parts: start');

    var entire_allocate_millistamp = time_utils.millistamp();
    var reply = {
        parts: _.map(parts, function(part) {
            // checking that parts size does not exceed the max
            // which allows the read path to limit range scanning
            if (part.end - part.start > config.MAX_OBJECT_PART_SIZE) {
                throw new Error('allocate_object_parts: PART TOO BIG ' +
                    range_utils.human_range(part));
            }
            // create empty object for each part for the reply
            return {};
        })
    };

    return P.when(find_dups_and_existing_parts(bucket, obj, parts))
        .then(function(find_res) {
            find_result = find_res;
            return P.when(call_allocation(bucket, obj, parts, reply, find_result.digest_to_chunk));
        })
        .then(function(call_res) {
            call_alloc_result = call_res;
            return P.when(update_db_on_alloc(call_alloc_result, find_result));
        })
        .then(function() {
            dbg.log2('allocate_object_parts: DONE. parts', parts.length, 'took',
                time_utils.millitook(entire_allocate_millistamp));
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

    return P.join(

            // find parts by start offset, deleted parts are handled later
            find_consecutive_parts(obj, parts)
            .exec()
            .then(db.populate('chunk', db.DataChunk)),

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
        )
        .spread(function(parts_res, blocks) {
            var parts_by_start = _.groupBy(parts_res, 'start');
            chunks = _.flatten(_.map(parts, function(part) {
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
                    //  was already unset, and just go ahead with calling object_utils.build_chunks
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
            return P.fcall(function() {
                    return object_utils.build_chunks(chunks);
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
                return P.when(db.ObjectMD.collection.updateOne({
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

    return P.fcall(function() {

            // find parts intersecting the [start,end) range
            var find = db.ObjectPart.find({
                    obj: params.obj.id,
                    start: {
                        // since end is not indexed we query start with both
                        // low and high constraint, which allows the index to reduce scan
                        // we use a constant that limits the max part size because
                        // this is the only way to limit the minimal start value
                        $gte: start - config.MAX_OBJECT_PART_SIZE,
                        $lt: end,
                    },
                    end: {
                        $gt: start
                    },
                    deleted: null,
                })
                .sort('start');
            if (params.skip) find.skip(params.skip);
            if (params.limit) find.limit(params.limit);
            return find.exec();
        })
        .then(db.populate('chunk', db.DataChunk))
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

    return P.fcall(function() {
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
            dbg.warn('read_node_mappings: SLOW QUERY',
                'ObjectPart.find(chunk $in array).',
                'adding chunk index?');
            return db.ObjectPart.find({
                    chunk: {
                        $in: _.map(blocks, 'chunk')
                    },
                    deleted: null,
                })
                .exec();
        })
        .then(db.populate('chunk', db.DataChunk))
        .then(db.populate('obj', db.ObjectMD))
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

            return db.Bucket.find({
                    _id: {
                        $in: db.uniq_ids(_.map(objects, 'bucket'))
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
    return P.when(db.DataBlock.find({
                chunk: {
                    $in: chunk_ids
                },
                deleted: null,
            })
            .sort('frag')
            .exec())
        .then(db.populate('node', db.Node))
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            return P.all(_.map(params.parts, function(part) {
                var chunk = part.chunk;
                var blocks = blocks_by_chunk[chunk.id];
                return get_part_info({
                    part: part,
                    chunk: chunk,
                    blocks: blocks,
                    set_obj: params.set_obj,
                    adminfo: params.adminfo
                });
            }));
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
    return P.when(db.ObjectPart.find({
                obj: params.obj.id,
                upload_part_number: {
                    $gte: marker,
                    $lt: marker + max_parts
                },
                deleted: null,
            })
            .sort('upload_part_number')
            // TODO set .limit(max_parts?)
            .exec())
        .then(db.populate('chunk', db.DataChunk))
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
 * set_multipart_part_md5
 *
 */
function set_multipart_part_md5(params) {
    return P.when(db.ObjectPart.find({
                system: params.obj.system,
                obj: params.obj._id,
                upload_part_number: params.upload_part_number,
                part_sequence_number: 0,
                deleted: null,
            })
            .sort({
                _id: -1 // when same, get newest first
            })
            .exec())
        .then(function(part_obj) {
            dbg.log1('set_multipart_part_md5_obj: ', part_obj[0]._id, params.etag);
            return P.when(db.ObjectPart.update({
                _id: part_obj[0]._id
            }, {
                $set: {
                    etag: params.etag
                }
            }).exec());
        })
        .return();
}
/**
 *
 * calc_multipart_md5
 *
 */
function calc_multipart_md5(obj) {
    var aggregated_nobin_md5 = '';
    var aggregated_bin_md5 = '';
    return P.fcall(function() {
        // find part that need update of start and end offsets
        dbg.warn('calc_multipart_md5: SLOW QUERY',
            'ObjectPart.find(part_sequence_number:0).',
            'add part_sequence_number to index?');
        return db.ObjectPart.find({
                system: obj.system,
                obj: obj,
                part_sequence_number: 0,
                deleted: null,
                etag: {
                    $exists: true
                }
            })
            .sort({
                upload_part_number: 1,
                _id: -1 // when same, get newest first
            })
            .exec();
    }).then(function(upload_parts) {
        _.each(upload_parts, function(part) {
            var part_md5 = part.etag;
            aggregated_nobin_md5 = aggregated_nobin_md5 + part_md5;
            aggregated_bin_md5 = aggregated_bin_md5 + string_utils.toBinary(part_md5);
            dbg.log0('part', part, ' with md5', part_md5, 'aggregated:', aggregated_nobin_md5);
        });
        var digester = crypto.createHash('md5');
        digester.update(aggregated_bin_md5);
        var aggregated_md5 = digester.digest('hex') + '-' + upload_parts.length;
        dbg.log0('aggregated etag:', aggregated_md5, ' for ', obj.key);
        return aggregated_md5;
    });
}
/**
 *
 * fix_multipart_parts
 *
 */
function fix_multipart_parts(obj) {
    return P.join(
            P.fcall(function() {
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
        )
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
                            upload_part_number: '',
                            etag: ''
                        }
                    });
                    last_end = current_end;
                    last_upload_part_number = part.upload_part_number;
                    last_part_sequence_number = part.part_sequence_number;
                }
            });
            // calling execute on bulk and handling node callbacks
            return P.ninvoke(bulk_update, 'execute').thenResolve(last_end);
        });
}



/*
 * agent_delete_call
 * calls the agent with the delete API
 */
function agent_delete_call(node, del_blocks) {
    return P.fcall(function() {
        var block_md = object_utils.get_block_md(del_blocks[0]);
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
    P.when(db.DataBlock.find({
                chunk: {
                    $in: deleted_chunk_ids
                },
                //For now, query deleted as well as this gets executed in
                //delete_object_mappings with P.all along with the DataBlocks
                //deletion update
            })
            .exec())
        .then(db.populate('node', db.Node))
        .then(function(deleted_blocks) {
            //TODO: If the overload of these calls is too big, we should protect
            //ourselves in a similar manner to the replication
            var blocks_by_node = _.groupBy(deleted_blocks, function(b) {
                return b.node._id;
            });

            return P.all(_.map(blocks_by_node, function(blocks, node) {
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
    return P.when(db.ObjectPart.find({
                obj: obj.id,
                deleted: null,
            })
            .exec())
        .then(db.populate('chunk', db.DataChunk))
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
            var chunks = _.map(deleted_parts, 'chunk');
            all_chunk_ids = _.pluck(chunks, '_id');
            //For every chunk, verify if its no longer referenced
            return db.ObjectPart.find({
                    chunk: {
                        $in: all_chunk_ids
                    },
                    deleted: null,
                }, {
                    chunk: 1
                })
                .exec();
        })
        .then(function(referring_parts) {
            //Seperate non referred chunks
            var referred_chunks_ids = db.uniq_ids(_.map(referring_parts, 'chunk'));
            var non_referred_chunks_ids =
                db.obj_ids_difference(all_chunk_ids, referred_chunks_ids);
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
            return P.join(
                db.DataChunk.update(chunk_query, deleted_update, multi_opt).exec(),
                db.DataBlock.update(block_query, deleted_update, multi_opt).exec(),
                delete_objects_from_agents(non_referred_chunks_ids)
            );
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
    return P.join(
            db.DataBlock.findById(params.block_id).exec(),
            db.ObjectPart.findOne(_.extend({
                system: params.obj.system,
                obj: params.obj.id,
            }, _.pick(params,
                'start',
                'end',
                'upload_part_number',
                'part_sequence_number')))
            .exec()
            .then(db.populate('chunk', db.DataChunk))
        )
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

                return P.when(
                        db.DataBlock.find({
                            chunk: chunk,
                            deleted: null,
                        })
                        .exec())
                    .then(db.populate('node', db.Node))
                    .then(function(all_blocks) {
                        var avoid_nodes = _.map(all_blocks, function(block) {
                            return block.node._id.toString();
                        });
                        return policy_allocation.allocate_on_pools(chunk, avoid_nodes);
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
                        return policy_allocation.remove_allocation([bad_block]);
                    })
                    .then(function() {
                        dbg.log0('report_bad_block: DONE. create new_block', new_block,
                            'params', params);
                        return object_utils.get_block_md(new_block);
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

/**
 *
 * chunks_and_objects_count
 *
 */
function chunks_and_objects_count(systemid) {
    return P.join(
            db.DataChunk.count({
                system: systemid,
                deleted: null,
            }).exec(),
            db.ObjectMD.count({
                system: systemid,
                deleted: null,
            }).exec()
        )
        .spread(function(chunks_num, objects_num) {
            return {
                chunks_num: chunks_num,
                objects_num: objects_num,
            };
        });
}

// UTILS //////////////////////////////////////////////////////////

function get_part_info(params) {
    return P.when(policy_allocation.get_pools_groups(params.chunk.bucket))
        .then(function(pools) {
            return P.when(policy_allocation.analyze_chunk_status_on_pools(params.chunk, params.blocks, pools))
                .then(function(chunk_status) {
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

                        var part_fragment = _.pick(fragment, 'layer', 'layer_n', 'frag', 'size');

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
                                block_md: object_utils.get_block_md(block),
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
                });
        });
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
    start = Math.floor(start);
    end = Math.floor(end);
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

function find_consecutive_parts(obj, parts) {
    var start = parts[0].start;
    var end = parts[parts.length - 1].end;
    var upload_part_number = parts[0].upload_part_number;
    var pos = start;
    _.each(parts, function(part) {
        if (pos !== part.start) {
            throw new Error('expected parts to be consecutive');
        }
        if (upload_part_number !== part.upload_part_number) {
            throw new Error('expected parts to have same upload_part_number');
        }
        pos = part.end;
    });
    return db.ObjectPart.find({
            system: obj.system,
            obj: obj.id,
            upload_part_number: upload_part_number,
            start: {
                // since end is not indexed we query start with both
                // low and high constraint, which allows the index to reduce scan
                $gte: start,
                $lte: end
            },
            end: {
                $lte: end
            },
            deleted: null
        })
        .sort('start');
}

//Find dups and existing parts, and analyze their health
function find_dups_and_existing_parts(bucket, obj, parts) {
    var existing_chunks;
    var existing_parts;
    var digest_to_chunk = {};

    var find_dups_millistamp = time_utils.millistamp();

    return P.join(
            // find the parts already exists from previous attempts
            // that will be removed.
            // their chunks will be used though.
            find_consecutive_parts(obj, parts)
            .exec()
            .then(db.populate('chunk', db.DataChunk)),

            // dedup with existing chunks by lookup of the digest of the data
            process.env.DEDUP_DISABLED !== 'true' &&
            P.when(db.DataChunk.find({
                    system: obj.system,
                    bucket: bucket._id,
                    digest_b64: {
                        $in: _.uniq(_.map(parts, function(part) {
                            return part.chunk.digest_b64;
                        }))
                    },
                    deleted: null,
                    building: null
                })
                .exec())
        )
        .spread(function(existing_parts_arg, dup_chunks) {
            existing_parts = existing_parts_arg;
            existing_chunks = dup_chunks || [];
            _.each(existing_parts, function(existing_part) {
                if (existing_part.chunk) {
                    existing_chunks.push(existing_part.chunk);
                }
            });
            // find blocks of the dup chunks and existing parts chunks
            dbg.log0('find_dups_and_existing_parts (1) took',
                time_utils.millitook(find_dups_millistamp));
            var chunks_ids = db.uniq_ids(_.map(existing_chunks, '_id'));
            return chunks_ids.length && P.when(
                    db.DataBlock.find({
                        chunk: {
                            $in: chunks_ids
                        },
                        deleted: null,
                    })
                    .lean() // for faster performance. returns object without mongoose overhead, which is not needed here.
                    .exec())
                .then(db.populate('node', db.Node));
        })
        .then(function(blocks) {
            dbg.log0('find_dups_and_existing_parts (2.5)  ', blocks.length, 'took',
                time_utils.millitook(find_dups_millistamp));
            // assign blocks to chunks
            var blocks_by_chunk_id = _.groupBy(blocks, 'chunk');
            // filter only the available chunks to be used for dedup
            if (!existing_chunks) {
                return;
            }
            return P.map(existing_chunks, function(chunk) {
                chunk.all_blocks = blocks_by_chunk_id[chunk._id];
                return P.when(policy_allocation.get_pools_groups(chunk.bucket))
                    .then(function(pools) {
                        return P.when(policy_allocation.analyze_chunk_status_on_pools(chunk, chunk.all_blocks, pools))
                            .then(function(cstatus) {
                                chunk.chunk_status = cstatus;
                                var prev = digest_to_chunk[chunk.digest_b64];
                                if (prev) {
                                    dbg.log1('find_dups_and_existing_parts: already found chunk for digest', prev, chunk);
                                } else if (chunk.chunk_status.chunk_health === 'unavailable') {
                                    dbg.log1('find_dups_and_existing_parts: ignore unavailable chunk', chunk);
                                } else {
                                    digest_to_chunk[chunk.digest_b64] = chunk;
                                }
                            });
                    });
            });
        })
        .then(function() {
            dbg.log0('find_dups_and_existing_parts DONE', existing_chunks.length, existing_parts.length, 'took',
                time_utils.millitook(find_dups_millistamp));
            return {
                existing_chunks: existing_chunks,
                existing_parts: existing_parts,
                digest_to_chunk: digest_to_chunk
            };
        });
}


//Create chunks and parts and call for allocation
function call_allocation(bucket, obj, parts, reply, digest_to_chunk) {
    var new_blocks = [];
    var new_chunks = [];
    var new_parts = [];

    var call_allocation_millistamp = time_utils.millistamp();

    return P.map(parts, function(part, i) {
            var reply_part = reply.parts[i];
            var dup_chunk = digest_to_chunk[part.chunk.digest_b64];

            dbg.log1('call_allocation: allocate part',
                part.start, part.end, part.part_sequence_number,
                'dup_chunk', dup_chunk);
            if (dup_chunk) {
                part.db_chunk = dup_chunk;
                reply_part.dedup = true;
            } else {
                part.db_chunk = /*new db.DataChunk*/ (_.extend({
                    _id: db.new_object_id(),
                    system: obj.system,
                    bucket: bucket._id,
                    building: new Date(),
                }, part.chunk));
                new_chunks.push(part.db_chunk);
            }

            // create a new part
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

            if (reply_part.dedup) {
                dbg.log3('call_allocation: using dup chunk');
                return;
            }

            // Chunk is not available, create a new fragment on it
            dbg.log2('call_allocation: chunk is unavailable,',
                'allocating new block for it', part.db_chunk);
            var avoid_nodes = _.map(part.db_chunk.all_blocks, function(block) {
                return block.node._id.toString();
            });
            return P.map(part.frags, function(fragment) {
                    return P.when(policy_allocation.get_pools_groups(part.db_chunk.bucket))
                        .then(function(pools) {
                            return policy_allocation.allocate_on_pools(part.db_chunk, avoid_nodes, pools)
                                .then(function(block) {
                                    if (!block) {
                                        throw new Error('call_allocation: no nodes for allocation');
                                    }
                                    block.size = fragment.size;
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
                        });
                })
                .then(function(new_blocks_of_chunk) {
                    dbg.log2('call_allocation: part info', part,
                        'chunk', part.db_chunk,
                        'blocks', new_blocks_of_chunk);
                    return P.when(get_part_info({
                            part: part,
                            chunk: part.db_chunk,
                            blocks: new_blocks_of_chunk,
                            building: true
                        }))
                        .then(function(r) {
                            reply_part.part = r;
                        });
                });
        })
        .then(function() {
            dbg.log0('call_allocation DONE took',
                time_utils.millitook(call_allocation_millistamp));
            return {
                new_chunks: new_chunks,
                new_parts: new_parts,
                new_blocks: new_blocks,
            };
        });
}

function update_db_on_alloc(alloc_info, existing_info) {
    _.each(alloc_info.new_blocks, function(x) {
        x.node = x.node._id;
        x.chunk = x.chunk._id;
    });
    _.each(alloc_info.new_parts, function(x) {
        x.obj = db.new_object_id(x.obj);
        x.chunk = x.chunk._id;
    });
    dbg.log2('update_db_on_alloc: db create blocks', alloc_info.new_blocks);
    dbg.log2('update_db_on_alloc: db create chunks', alloc_info.new_chunks);
    dbg.log2('update_db_on_alloc: db remove existing parts', existing_info.existing_parts);
    dbg.log2('update_db_on_alloc: db create parts', alloc_info.new_parts);
    // we send blocks and chunks to DB in parallel,
    // even if we fail, it will be ignored until someday we reclaim it
    return P.join(
            // new_blocks.length && db.DataBlock.create(new_blocks),
            alloc_info.new_blocks.length && P.when(db.DataBlock.collection.insertMany(alloc_info.new_blocks)),
            // new_chunks.length && db.DataChunk.create(new_chunks),
            alloc_info.new_chunks.length && P.when(db.DataChunk.collection.insertMany(alloc_info.new_chunks)),
            existing_info.existing_parts.length && db.ObjectPart.update({
                _id: {
                    $in: _.map(existing_info.existing_parts, '_id')
                }
            }, {
                deleted: new Date()
            }, {
                multi: true
            })
            .exec()
        )
        .then(function() {
            return alloc_info.new_parts.length && P.when(db.ObjectPart.collection.insertMany(alloc_info.new_parts));
        });
}
