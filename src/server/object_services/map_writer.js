/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const crypto = require('crypto');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('./md_store').MDStore;
const mongo_utils = require('../../util/mongo_utils');
const time_utils = require('../../util/time_utils');


/**
 *
 * finalize_object_parts
 * after the 1st block was uploaded this creates more blocks on other nodes
 * to replicate to but only in the db.
 *
 */
function finalize_object_parts(bucket, obj, parts) {
    // console.log('GGG finalize_object_parts', require('util').inspect(parts, { depth: null }));
    const millistamp = time_utils.millistamp();
    const new_parts = [];
    const new_chunks = [];
    const new_blocks = [];
    let upload_size = obj.upload_size || 0;
    _.each(parts, part => {
        if (upload_size < part.end) {
            upload_size = part.end;
        }
        let chunk_id;
        if (part.chunk_dedup) {
            chunk_id = MDStore.instance().make_md_id(part.chunk_dedup);
        } else {
            chunk_id = MDStore.instance().make_md_id();
            _.each(part.chunk.frags, f => {
                _.each(f.blocks, block => {
                    new_blocks.push(_.extend({
                        _id: MDStore.instance().make_md_id(block.block_md.id),
                        system: obj.system,
                        bucket: bucket._id,
                        chunk: chunk_id,
                        node: mongo_utils.make_object_id(block.block_md.node)
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
        const new_part = {
            _id: MDStore.instance().make_md_id(),
            system: obj.system,
            bucket: bucket._id,
            obj: obj._id,
            start: part.start,
            end: part.end,
            seq: part.seq,
            chunk: chunk_id,
        };
        if (part.multipart_id) {
            new_part.multipart = MDStore.instance().make_md_id(part.multipart_id);
        }
        new_parts.push(new_part);
    });

    return P.join(
            MDStore.instance().insert_blocks(new_blocks),
            MDStore.instance().insert_chunks(new_chunks),
            MDStore.instance().insert_parts(new_parts),
            (upload_size > obj.upload_size) &&
            MDStore.instance().update_object_by_id(obj._id, { upload_size: upload_size })
        )
        .then(() => {
            dbg.log0('finalize_object_parts: DONE. parts', parts.length,
                'took', time_utils.millitook(millistamp));
        }, err => {
            dbg.error('finalize_object_parts: ERROR', err.stack || err);
            throw err;
        });
}


/**
 *
 * complete_object_parts
 *
 */
function complete_object_parts(obj, multiparts_req) {
    // TODO consider multiparts_req
    let pos = 0;
    let seq = 0;
    let num_parts = 0;
    let multipart_etag = '';
    const parts_updates = [];

    function process_next_parts(parts) {
        parts.sort((a, b) => a.seq - b.seq);
        for (const part of parts) {
            const len = part.end - part.start;
            if (part.seq !== seq) {
                console.log('complete_object_parts: update part at seq', seq,
                    'pos', pos, 'len', len, part._id);
                parts_updates.push({
                    _id: part._id,
                    set_updates: {
                        seq: seq,
                        start: pos,
                        end: pos + len,
                    }
                });
            }
            pos += len;
            seq += 1;
            num_parts += 1;
        }
    }

    return P.join(
            MDStore.instance().find_parts_of_object(obj),
            multiparts_req && MDStore.instance().find_multiparts_of_object(obj._id, 0, 10000)
        )
        .spread((parts, multiparts) => {
            if (!multiparts) return process_next_parts(parts);
            const parts_by_mp = _.groupBy(parts, 'multipart');
            const md5 = crypto.createHash('md5');
            for (const multipart of multiparts) {
                md5.update(multipart.md5_b64, 'base64');
                const mp_parts = parts_by_mp[multipart._id];
                process_next_parts(mp_parts);
            }
            multipart_etag = md5.digest('hex') + '-' + multiparts.length;
        })
        .then(() => MDStore.instance().update_parts_in_bulk(parts_updates))
        .then(() => ({
            size: pos,
            num_parts,
            multipart_etag,
        }));
}


// EXPORTS
exports.finalize_object_parts = finalize_object_parts;
exports.complete_object_parts = complete_object_parts;
