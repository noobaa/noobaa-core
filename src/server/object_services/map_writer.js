/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const time_utils = require('../../util/time_utils');
const range_utils = require('../../util/range_utils');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');

// dbg.set_level(5);


/**
 *
 * The mapping allocation flow
 *
 */
class MapAllocator {

    constructor(bucket, obj, parts) {
        this.bucket = bucket;
        this.obj = obj;
        this.parts = parts;
    }

    run_select_tier() {
        return P.resolve()
            .then(() => this.prepare_tiering_for_alloc())
            .then(() => mapper.select_tier_for_write(this.bucket.tiering, this.tiering_status));
    }

    run_allocate_parts() {
        const millistamp = time_utils.millistamp();
        dbg.log1('MapAllocator: start');
        return P.resolve()
            .then(() => this.prepare_tiering_for_alloc())
            .then(() => this.check_parts())
            .then(() => this.find_dups())
            .then(() => this.allocate_blocks())
            .then(() => {
                dbg.log0('MapAllocator: DONE. parts', this.parts.length,
                    'took', time_utils.millitook(millistamp));
                return {
                    parts: this.parts
                };
            })
            .catch(err => {
                dbg.error('MapAllocator: ERROR', err.stack || err);
                throw err;
            });
    }

    prepare_tiering_for_alloc() {
        const tiering = this.bucket.tiering;
        return P.resolve()
            .then(() => node_allocator.refresh_tiering_alloc(tiering))
            .then(() => {
                this.tiering_status = node_allocator.get_tiering_status(tiering);
            });
    }

    check_parts() {
        for (let i = 0; i < this.parts.length; ++i) {
            const part = this.parts[i];

            // checking that parts size does not exceed the max
            // which allows the read path to limit range scanning - see map_reader.js
            if (part.end - part.start > config.MAX_OBJECT_PART_SIZE) {
                throw new Error('MapAllocator: PART TOO BIG ' + range_utils.human_range(part));
            }
        }
    }

    find_dups() {
        if (!config.DEDUP_ENABLED) return;
        const dedup_keys = _.map(this.parts, part => Buffer.from(part.chunk.digest_b64, 'base64'));
        dbg.log3('MapAllocator.find_dups', dedup_keys.length);
        return MDStore.instance().find_chunks_by_dedup_key(this.bucket, dedup_keys)
            .then(dup_chunks => {
                for (let i = 0; i < dup_chunks.length; ++i) {
                    const dup_chunk = dup_chunks[i];
                    dup_chunk.chunk_coder_config = system_store.data.get_by_id(dup_chunk.chunk_config).chunk_coder_config;
                    const is_good_for_dedup = mapper.is_chunk_good_for_dedup(
                        dup_chunk, this.bucket.tiering, this.tiering_status
                    );
                    if (is_good_for_dedup) {
                        for (let j = 0; j < this.parts.length; ++j) {
                            const part = this.parts[j];
                            if (part.chunk &&
                                part.chunk.size === dup_chunk.size &&
                                part.chunk.digest_b64 === dup_chunk.digest.toString('base64')) {
                                part.chunk_id = dup_chunk._id;
                                delete part.chunk;
                            }
                        }
                    }
                }
            });
    }

    allocate_blocks() {
        for (let i = 0; i < this.parts.length; ++i) {
            const part = this.parts[i];

            // skip parts that we found dup
            if (part.chunk_id) continue;

            const chunk = part.chunk;
            const avoid_nodes = [];
            const allocated_hosts = [];

            const mapping = mapper.map_chunk(chunk, this.bucket.tiering, this.tiering_status);

            _.forEach(mapping.allocations, ({ frag, pools }) => {
                const node = node_allocator.allocate_node(pools, avoid_nodes, allocated_hosts);
                if (!node) {
                    throw new Error(`MapAllocator: no nodes for allocation (avoid_nodes: ${avoid_nodes.join(',')})`);
                }
                const block = {
                    _id: MDStore.instance().make_md_id(),
                };
                mapper.assign_node_to_block(block, node, this.bucket.system._id);
                frag.blocks = frag.blocks || [];
                frag.blocks.push(mapper.get_block_info(chunk, frag, block));
                avoid_nodes.push(String(node._id));
                allocated_hosts.push(node.host_id);
            });
        }
    }

}

function select_tier_for_write(bucket, obj) {
    return new MapAllocator(bucket, obj).run_select_tier();
}

function allocate_object_parts(bucket, obj, parts) {
    return new MapAllocator(bucket, obj, parts).run_allocate_parts();
}

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
    const now = new Date();
    const new_parts = [];
    const new_chunks = [];
    const new_blocks = [];
    let upload_size = obj.upload_size || 0;

    for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (upload_size < part.end) {
            upload_size = part.end;
        }
        let chunk_id;
        if (part.chunk_id) {
            chunk_id = MDStore.instance().make_md_id(part.chunk_id);
        } else {
            chunk_id = MDStore.instance().make_md_id();
            const chunk = part.chunk;
            const digest = chunk.digest_b64 && Buffer.from(chunk.digest_b64, 'base64');
            const chunk_config = _.find(bucket.system.chunk_configs_by_id,
                c => _.isEqual(c.chunk_coder_config, chunk.chunk_coder_config))._id;
            new_chunks.push(_.omitBy({
                _id: chunk_id,
                system: obj.system,
                bucket: bucket._id,
                chunk_config,
                size: chunk.size,
                compress_size: chunk.compress_size,
                frag_size: chunk.frag_size,
                dedup_key: digest,
                digest,
                cipher_key: chunk.cipher_key_b64 && Buffer.from(chunk.cipher_key_b64, 'base64'),
                cipher_iv: chunk.cipher_iv_b64 && Buffer.from(chunk.cipher_iv_b64, 'base64'),
                cipher_auth_tag: chunk.cipher_auth_tag_b64 && Buffer.from(chunk.cipher_auth_tag_b64, 'base64'),
                frags: _.map(part.chunk.frags, frag => {
                    const frag_id = MDStore.instance().make_md_id();
                    _.each(frag.blocks, block => {
                        const block_id = MDStore.instance().make_md_id(block.block_md.id);
                        const block_id_time = block_id.getTimestamp().getTime();
                        if (block_id_time < now.getTime() - (config.MD_GRACE_IN_MILLISECONDS - config.MD_AGGREGATOR_INTERVAL)) {
                            dbg.error('finalize_object_parts: A big gap was found between id creation and addition to DB:',
                                block, bucket.name, obj.key, block_id_time, now.getTime());
                        }
                        if (block_id_time < bucket.storage_stats.last_update + config.MD_AGGREGATOR_INTERVAL) {
                            dbg.error('finalize_object_parts: A big gap was found between id creation and bucket last update:',
                                block, bucket.name, obj.key, block_id_time, bucket.storage_stats.last_update);
                        }
                        new_blocks.push({
                            _id: block_id,
                            system: obj.system,
                            bucket: bucket._id,
                            chunk: chunk_id,
                            frag: frag_id,
                            node: mongo_utils.make_object_id(block.block_md.node),
                            pool: mongo_utils.make_object_id(block.block_md.pool),
                            size: chunk.frag_size,
                        });
                    });
                    return _.omitBy({
                        _id: frag_id,
                        data_index: frag.data_index,
                        parity_index: frag.parity_index,
                        lrc_index: frag.lrc_index,
                        digest: frag.digest_b64 && Buffer.from(frag.digest_b64, 'base64')
                    }, _.isUndefined);
                })
            }, _.isUndefined));
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
    }

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
                dbg.log0('complete_object_parts: update part at seq', seq,
                    'pos', pos, 'len', len,
                    'part', util.inspect(part, { colors: true, depth: null, breakLength: Infinity }));
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
exports.select_tier_for_write = select_tier_for_write;
exports.allocate_object_parts = allocate_object_parts;
exports.finalize_object_parts = finalize_object_parts;
exports.complete_object_parts = complete_object_parts;
