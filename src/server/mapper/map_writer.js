/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var crypto = require('crypto');
var db = require('../db');
var md_store = require('../stores/md_store');
var nodes_store = require('../stores/nodes_store');
var mongo_utils = require('../../util/mongo_utils');
var time_utils = require('../../util/time_utils');
var string_utils = require('../../util/string_utils');
// var map_utils = require('./map_utils');
var dbg = require('../../util/debug_module')(__filename);

exports.finalize_object_parts = finalize_object_parts;
exports.list_multipart_parts = list_multipart_parts;
exports.fix_multipart_parts = fix_multipart_parts;
exports.calc_multipart_md5 = calc_multipart_md5;
exports.set_multipart_part_md5 = set_multipart_part_md5;


/**
 *
 * finalize_object_parts
 * after the 1st block was uploaded this creates more blocks on other nodes
 * to replicate to but only in the db.
 *
 */
function finalize_object_parts(bucket, obj, parts) {
    // console.log('GGG finalize_object_parts', require('util').inspect(parts, {
    //     depth: null
    // }));
    let millistamp = time_utils.millistamp();
    let new_parts = [];
    let new_chunks = [];
    let new_blocks = [];
    let upload_size = obj.upload_size || 0;
    _.each(parts, part => {
        if (upload_size < part.end) {
            upload_size = part.end;
        }
        let chunk_id;
        if (part.chunk_dedup) {
            chunk_id = md_store.make_md_id(part.chunk_dedup);
        } else {
            chunk_id = md_store.make_md_id();
            _.each(part.chunk.frags, f => {
                _.each(f.blocks, block => {
                    new_blocks.push(_.extend({
                        _id: md_store.make_md_id(block.block_md.id),
                        system: obj.system,
                        chunk: chunk_id,
                        node: nodes_store.make_node_id(block.block_md.node)
                    }, _.pick(f,
                        'size',
                        'layer',
                        'layer_n',
                        'frag',
                        'digest_type',
                        'digest_b64')));
                });
            });
            new_chunks.push(_.extend({
                _id: chunk_id,
                system: obj.system,
                bucket: bucket._id,
            }, _.pick(part.chunk,
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
                'lrc_frags')));
        }
        new_parts.push({
            _id: md_store.make_md_id(),
            system: obj.system,
            obj: obj._id,
            start: part.start,
            end: part.end,
            part_sequence_number: part.part_sequence_number,
            upload_part_number: part.upload_part_number || 0,
            chunk: chunk_id
        });
    });

    return P.join(
            new_blocks.length && P.when(db.DataBlock.collection.insertMany(new_blocks)),
            new_chunks.length && P.when(db.DataChunk.collection.insertMany(new_chunks)),
            new_parts.length && P.when(db.ObjectPart.collection.insertMany(new_parts)),
            upload_size > obj.upload_size && P.when(db.ObjectMD.collection.updateOne({
                _id: obj._id
            }, {
                $set: {
                    upload_size: upload_size
                }
            }))
        )
        .then(function() {
            dbg.log0('finalize_object_parts: DONE. parts', parts.length,
                'took', time_utils.millitook(millistamp));
        }, function(err) {
            dbg.error('finalize_object_parts: ERROR', err.stack || err);
            throw err;
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
        .then(parts => mongo_utils.populate(parts, 'chunk', db.DataChunk))
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
                    let updated_item = upload_parts[num][0];
                    return {
                        part_number: parseInt(num, 10),
                        size: _.reduce(upload_parts[num], function(sum, part) {
                            return sum + part.end - part.start;
                        }, 0),
                        etag: updated_item.etag,
                        last_modified: updated_item._id.getTimestamp().getTime(),
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
                    etag: params.etag,
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
            dbg.log1('part', part, ' with md5', part_md5, 'aggregated:', aggregated_nobin_md5);
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
                            etag: '',
                        }
                    });
                    last_end = current_end;
                    last_upload_part_number = part.upload_part_number;
                    last_part_sequence_number = part.part_sequence_number;
                }
            });
            // calling execute on bulk and handling node callbacks
            if (bulk_update.length) {
                return P.ninvoke(bulk_update, 'execute').thenResolve(last_end);
            }
        });
}
