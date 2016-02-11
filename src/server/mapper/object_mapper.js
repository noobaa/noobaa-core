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
};

var _ = require('lodash');
var P = require('../../util/promise');
var crypto = require('crypto');
var db = require('../db');
var chunk_builder = require('./chunk_builder');
var policy_allocator = require('./policy_allocator');
var block_allocator = require('./block_allocator');
var MappingAllocator = require('./map_allocator');
var server_rpc = require('../server_rpc').server_rpc;
var system_store = require('../stores/system_store');
// var time_utils = require('../../util/time_utils');
var mongo_utils = require('../../util/mongo_utils');
var range_utils = require('../../util/range_utils');
var string_utils = require('../../util/string_utils');
var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');

/**
 *
 * allocate_object_parts - allocates the object parts, chunks and blocks and writes it to the db
 *
 */
function allocate_object_parts(bucket, obj, parts) {
    return new MappingAllocator(bucket, obj, parts).run();
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
            .then(mongo_utils.populate('chunk', db.DataChunk)),

            // find blocks by list of ids, deleted blocks are handled later
            block_ids.length &&
            db.DataBlock.collection.find({
                _id: {
                    $in: block_ids
                },
                // deleted blocks can occur due to report_bad_block,
                // so filter out and leave as trash
                deleted: null
            }).toArray()
        )
        .spread(function(parts_res, blocks) {
            var parts_by_start = _.groupBy(parts_res, 'start');
            chunks = _.flatten(_.map(parts, function(part) {
                var part_res = parts_by_start[part.start];
                if (!part_res) {
                    throw new Error('part not found for obj ' +
                        obj._id + ' ' + range_utils.human_range(part));
                }
                return _.map(part_res, function(p) {
                    return p.chunk;
                });
            }));
            var chunk_by_id = _.keyBy(chunks, '_id');
            _.each(blocks, function(block) {
                if (!block.building) {
                    dbg.warn("ERROR block not in building mode ", block);
                    // for reentrancy we avoid failing if the building mode
                    //  was already unset, and just go ahead with calling chunk_builder.build_chunks
                    // which will handle it all.
                    // throw new Error('block not in building mode');
                }
                var chunk = chunk_by_id[block.chunk.toString()];
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
            });
        })
        .then(function() {
            // using a timeout to limit our wait here.
            // in case of failure to build, we suppress the error for the
            // sake of user experienceand leave it to the background worker.
            // TODO dont suppress build errors, fix them.
            return P.fcall(function() {
                    return chunk_builder.build_chunks(chunks);
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
                }));
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
            return db.ObjectPart.collection.find({
                obj: params.obj._id,
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
            }, {
                sort: 'start',
                skip: params.skip || 0,
                limit: params.limit || 0
            }).toArray();
        })
        .then(mongo_utils.populate('chunk', db.DataChunk))
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
            return db.DataBlock.collection.find({
                node: params.node._id,
                deleted: null,
            }, {
                sort: '-_id',
                skip: params.skip || 0,
                limit: params.limit || 0
            }).toArray();
        })
        .then(function(blocks) {
            dbg.warn('read_node_mappings: SLOW QUERY',
                'ObjectPart.find(chunk $in array).',
                'adding chunk index?');
            return db.ObjectPart.collection.find({
                chunk: {
                    $in: mongo_utils.uniq_ids(blocks, 'chunk')
                },
                deleted: null,
            }).toArray();
        })
        .then(mongo_utils.populate('chunk', db.DataChunk))
        .then(mongo_utils.populate('obj', db.ObjectMD))
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
                objects[obj._id] = obj;
                return obj._id;
            });

            return _.map(objects, function(obj, obj_id) {
                return {
                    key: obj.key,
                    bucket: system_store.data.get_by_id(obj.bucket).name,
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
    var chunk_ids = mongo_utils.uniq_ids(chunks, '_id');

    // find all blocks of the resulting parts
    return P.when(db.DataBlock.collection.find({
            chunk: {
                $in: chunk_ids
            },
            deleted: null,
        }, {
            sort: 'frag'
        }).toArray())
        .then(mongo_utils.populate('node', db.Node))
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            return P.all(_.map(params.parts, function(part) {
                var chunk = part.chunk;
                var blocks = blocks_by_chunk[chunk._id];
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
    return P.when(db.ObjectPart.collection.find({
            obj: params.obj._id,
            upload_part_number: {
                $gte: marker,
                $lt: marker + max_parts
            },
            deleted: null,
        }, {
            sort: 'upload_part_number'
                // TODO set limit max_parts?
        }).toArray())
        .then(mongo_utils.populate('chunk', db.DataChunk))
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
    return P.when(db.ObjectPart.collection.find({
            system: params.obj.system,
            obj: params.obj._id,
            upload_part_number: params.upload_part_number,
            part_sequence_number: 0,
            deleted: null,
        }, {
            sort: '-_id' // when same, get newest first
        }).toArray())
        .then(function(part_obj) {
            dbg.log1('set_multipart_part_md5_obj: ', part_obj[0]._id, params.etag);
            return db.ObjectPart.collection.updateOne({
                _id: part_obj[0]._id
            }, {
                $set: {
                    etag: params.etag
                }
            });
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
        return db.ObjectPart.collection.find({
            system: obj.system,
            obj: obj._id,
            part_sequence_number: 0,
            deleted: null,
            etag: {
                $exists: true
            }
        }, {
            sort: {
                upload_part_number: 1,
                _id: -1 // when same, get newest first
            }
        }).toArray();
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
            // find part that need update of start and end offsets
            db.ObjectPart.collection.find({
                obj: obj._id,
                deleted: null
            }, {
                sort: {
                    upload_part_number: 1,
                    part_sequence_number: 1,
                    _id: -1 // when same, get newest first
                }
            }).toArray(),
            // query to find the last part without upload_part_number
            // which has largest end offset.
            db.ObjectPart.collection.find({
                obj: obj._id,
                upload_part_number: null,
                deleted: null
            }, {
                sort: {
                    end: -1
                },
                limit: 1
            }).toArray()
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
        var address = block_allocator.get_block_md(del_blocks[0]).address;
        var block_ids = _.map(del_blocks, function(block) {
            return block._id.toString();
        });
        return server_rpc.client.agent.delete_blocks({
            blocks: block_ids
        }, {
            address: address,
            timeout: 30000,
        }).then(function() {
            dbg.log0('agent_delete_call: DONE. node', node.name, 'block_ids', block_ids);
        }, function(err) {
            dbg.log0('agent_delete_call: ERROR node', node.name, 'block_ids', block_ids);
        });
    });
}

/*
 * delete_objects_from_agents
 * send delete request for the deleted DataBlocks to the agents
 */
function delete_objects_from_agents(deleted_chunk_ids) {
    //Find the deleted data blocks and their nodes
    P.when(db.DataBlock.collection.find({
            chunk: {
                $in: deleted_chunk_ids
            },
            //For now, query deleted as well as this gets executed in
            //delete_object_mappings with P.all along with the DataBlocks
            //deletion update
        }).toArray())
        .then(mongo_utils.populate('node', db.Node))
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
    return P.when(db.ObjectPart.collection.find({
            obj: obj._id,
            deleted: null,
        }).toArray())
        .then(mongo_utils.populate('chunk', db.DataChunk))
        .then(function(parts) {
            deleted_parts = parts;
            //Mark parts as deleted
            return db.ObjectPart.collection.updateMany({
                _id: {
                    $in: _.map(parts, '_id')
                }
            }, {
                $set: {
                    deleted: new Date()
                }
            });
        })
        .then(function() {
            var chunks = _.map(deleted_parts, 'chunk');
            all_chunk_ids = _.map(chunks, '_id');
            //For every chunk, verify if its no longer referenced
            return db.ObjectPart.collection.find({
                chunk: {
                    $in: all_chunk_ids
                },
                deleted: null,
            }, {
                fields: {
                    chunk: 1
                }
            }).toArray();
        })
        .then(function(referring_parts) {
            //Seperate non referred chunks
            var referred_chunks_ids = mongo_utils.uniq_ids(referring_parts, 'chunk');
            var non_referred_chunks_ids =
                mongo_utils.obj_ids_difference(all_chunk_ids, referred_chunks_ids);
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
                $set: {
                    deleted: new Date()
                }
            };
            return P.join(
                db.DataChunk.collection.updateMany(chunk_query, deleted_update),
                db.DataBlock.collection.updateMany(block_query, deleted_update),
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
            db.DataBlock.collection.findOne({
                _id: params.block_id
            }),
            db.ObjectPart.collection.findOne(_.extend({
                system: params.obj.system,
                obj: params.obj._id,
            }, _.pick(params,
                'start',
                'end',
                'upload_part_number',
                'part_sequence_number')))
            .then(mongo_utils.populate('chunk', db.DataChunk))
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
            if (!chunk || String(bad_block.chunk) !== String(chunk._id)) {
                dbg.error('report_bad_block: mismatching chunk for block', bad_block,
                    'and part', part, 'params', params);
                throw new Error('report_bad_block: mismatching chunk for block and part');
            }

            if (params.is_write) {
                var new_block;

                return P.when(db.DataBlock.collection.find({
                        chunk: chunk,
                        deleted: null,
                    }).toArray())
                    .then(mongo_utils.populate('node', db.Node))
                    .then(function(all_blocks) {
                        var avoid_nodes = _.map(all_blocks, function(block) {
                            return block.node._id.toString();
                        });
                        return policy_allocator.allocate_on_pools(chunk, avoid_nodes);
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
                        return policy_allocator.remove_allocation([bad_block]);
                    })
                    .then(function() {
                        dbg.log0('report_bad_block: DONE. create new_block', new_block,
                            'params', params);
                        return block_allocator.get_block_md(new_block);
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


// UTILS //////////////////////////////////////////////////////////

function get_part_info(params) {
    return P.when(policy_allocator.get_pools_groups(params.chunk.bucket))
        .then(function(pools) {
            //A single pool to be sent back with the MD (if adminfo is provided)
            //In case of spread, take first, in case of mirror take 1 of them (also the first)

            return P.when(policy_allocator.analyze_chunk_status_on_pools(params.chunk, params.blocks, pools))
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
                    if (params.part.part_sequence_number){
                        p.part_sequence_number = params.part.part_sequence_number;
                    }
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
                                block_md: block_allocator.get_block_md(block),
                            };
                            var node = block.node;
                            if (params.adminfo) {
                                var pool = system_store.data.get_by_id(node.pool);
                                var adminfo = {
                                    pool_name: pool.name,
                                    node_name: node.name,
                                    node_ip: node.ip,
                                    online: db.Node.is_online(node),
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
    return P.when(db.ObjectPart.collection.find({
        system: obj.system,
        obj: obj._id,
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
    }, {
        sort: 'start'
    }).toArray()).then(function(res) {
        console.log('find_consecutive_parts:', res, 'start', start, 'end', end);
        return res;
    });
}
