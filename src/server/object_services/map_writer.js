/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const time_utils = require('../../util/time_utils');
const range_utils = require('../../util/range_utils');
const mongo_utils = require('../../util/mongo_utils');
const node_allocator = require('../node_services/node_allocator');
const system_utils = require('../utils/system_utils');
const map_deleter = require('./map_deleter');
const map_builder = require('./map_builder');
const { RpcError } = require('../../rpc');


// dbg.set_level(5);


/**
 *
 * The mapping allocation flow
 *
 */
class MapAllocator {

    constructor(bucket, obj, parts, location_info) {
        this.bucket = bucket;
        this.obj = obj;
        this.parts = parts;
        this.location_info = location_info;
    }

    async run_select_tier() {
        await this.prepare_tiering_for_alloc();
        const tier = await mapper.select_tier_for_write(this.bucket.tiering, this.tiering_status);
        await map_builder.make_room_in_tier(tier, this.bucket, config.MIN_TIER_FREE_THRESHOLD * 10);
        return tier;
    }

    async run_allocate_parts() {
        const millistamp = time_utils.millistamp();
        dbg.log1('MapAllocator: start');
        try {
            await this.prepare_tiering_for_alloc();
            await this.check_parts();
            await this.find_dups();
            await this.allocate_blocks();
            dbg.log0('MapAllocator: DONE. parts', this.parts.length,
                'took', time_utils.millitook(millistamp));
            return {
                parts: this.parts
            };
        } catch (err) {
            dbg.error('MapAllocator: ERROR', err.stack || err);
            throw err;
        }
    }

    prepare_tiering_for_alloc() {
        const tiering = this.bucket.tiering;
        // const tier = tiering.tiers[0].tier;
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
        const dedup_keys = _.compact(_.map(this.parts,
            part => part.chunk.digest_b64 && Buffer.from(part.chunk.digest_b64, 'base64')));
        dbg.log3('MapAllocator.find_dups', dedup_keys.length);
        return MDStore.instance().find_chunks_by_dedup_key(this.bucket, dedup_keys)
            .then(dup_chunks => {
                for (let i = 0; i < dup_chunks.length; ++i) {
                    const dup_chunk = dup_chunks[i];
                    system_utils.prepare_chunk_for_mapping(dup_chunk);
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

            const tier = mapper.select_tier_for_write(this.bucket.tiering, this.tiering_status);
            chunk.tier = tier._id;

            const mapping = mapper.map_chunk(chunk, tier, this.bucket.tiering, this.tiering_status, this.location_info);

            _.forEach(mapping.allocations, ({ frag, pools }) => {
                const node = node_allocator.allocate_node(pools, avoid_nodes, allocated_hosts);
                if (!node) {
                    throw new Error(`MapAllocator: no nodes for allocation (avoid_nodes: ${avoid_nodes.join(',')})`);
                }
                const block = {
                    _id: MDStore.instance().make_md_id(),
                };
                mapper.assign_node_to_block(block, node, this.bucket.system._id);
                const block_info = mapper.get_block_info(chunk, frag, block);
                frag.blocks = frag.blocks || [];
                if (this.location_info && // optimizing local nodes/hosts - so it will be used for write rather than for replication 
                    (this.location_info.host_id === node.host_id || this.location_info.node_id === String(node._id))) {
                    frag.blocks.unshift(block_info);
                } else {
                    frag.blocks.push(block_info);
                }
                if (node.node_type === 'BLOCK_STORE_FS') {
                    avoid_nodes.push(String(node._id));
                    allocated_hosts.push(node.host_id);
                }
            });
        }
    }
}

function select_tier_for_write(bucket, obj) {
    return new MapAllocator(bucket, obj).run_select_tier();
}

function allocate_object_parts(bucket, obj, parts, location_info) {
    return new MapAllocator(bucket, obj, parts, location_info).run_allocate_parts();
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
                tier: mongo_utils.make_object_id(chunk.tier),
                tier_lru: new Date(),
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
                        if (!block.block_md.node || !block.block_md.pool) {
                            dbg.error('finalize_object_parts: Missing node/pool for block', block);
                            throw new Error('finalize_object_parts: Missing node/pool for block');
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
            uncommitted: true,
        };
        if (part.multipart_id) {
            new_part.multipart = MDStore.instance().make_md_id(part.multipart_id);
        }
        // dbg.log0('TODO GGG INSERT PART', JSON.stringify(new_part));
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
async function complete_object_parts(obj) {
    const context = {
        pos: 0,
        seq: 0,
        num_parts: 0,
        parts_updates: [],
    };

    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    _process_next_parts(parts, context);
    if (context.parts_updates.length) {
        await MDStore.instance().update_parts_in_bulk(context.parts_updates);
    }

    return {
        size: context.pos,
        num_parts: context.num_parts,
    };
}

/**
 *
 * complete_object_parts
 *
 */
async function complete_object_multiparts(obj, multipart_req) {
    const context = {
        pos: 0,
        seq: 0,
        num_parts: 0,
        parts_updates: [],
    };

    const [multiparts, parts] = await P.join(
        MDStore.instance().find_all_multiparts_of_object(obj._id),
        MDStore.instance().find_all_parts_of_object(obj)
    );

    let next_part_num = 1;
    const md5 = crypto.createHash('md5');
    const parts_by_mp = _.groupBy(parts, 'multipart');
    const multiparts_by_num = _.groupBy(multiparts, 'num');
    const used_parts = [];
    const used_multiparts = [];

    for (const { num, etag } of multipart_req) {
        if (num !== next_part_num) {
            throw new RpcError('INVALID_PART',
                `multipart num=${num} etag=${etag} expected next_part_num=${next_part_num}`);
        }
        next_part_num += 1;
        const etag_md5_b64 = Buffer.from(etag, 'hex').toString('base64');
        const group = multiparts_by_num[num];
        group.sort(_sort_multiparts_by_create_time);
        const mp = _.find(group, it => it.md5_b64 === etag_md5_b64 && it.create_time);
        if (!mp) {
            throw new RpcError('INVALID_PART',
                `multipart num=${num} etag=${etag} etag_md5_b64=${etag_md5_b64} not found in group ${util.inspect(group)}`);
        }
        md5.update(mp.md5_b64, 'base64');
        const mp_parts = parts_by_mp[mp._id];
        _process_next_parts(mp_parts, context);
        used_multiparts.push(mp);
        // console.log('TODO GGG COMPLETE MULTIPART', JSON.stringify(mp));
        for (const part of mp_parts) {
            used_parts.push(part);
            // console.log('TODO GGG COMPLETE PART', JSON.stringify(part));
        }
    }

    const multipart_etag = md5.digest('hex') + '-' + (next_part_num - 1);
    const unused_parts = _.difference(parts, used_parts);
    const unused_multiparts = _.difference(multiparts, used_multiparts);
    const chunks_to_dereference = unused_parts.map(part => part.chunk);
    const used_multiparts_ids = used_multiparts.map(mp => mp._id);

    dbg.log0('complete_object_multiparts:', obj, 'size', context.pos,
        'num_parts', context.num_parts, 'multipart_etag', multipart_etag);

    // for (const mp of unused_multiparts) dbg.log0('TODO GGG DELETE UNUSED MULTIPART', JSON.stringify(mp));
    // for (const part of unused_parts) dbg.log0('TODO GGG DELETE UNUSED PART', JSON.stringify(part));

    await P.join(
        context.parts_updates.length && MDStore.instance().update_parts_in_bulk(context.parts_updates),
        used_multiparts_ids.length && MDStore.instance().update_multiparts_by_ids(used_multiparts_ids, undefined, { uncommitted: 1 }),
        unused_parts.length && MDStore.instance().delete_parts(unused_parts),
        unused_multiparts.length && MDStore.instance().delete_multiparts(unused_multiparts),
        chunks_to_dereference.length && map_deleter.delete_chunks_if_unreferenced(chunks_to_dereference),
    );

    return {
        size: context.pos,
        num_parts: context.num_parts,
        multipart_etag,
    };
}

function _sort_parts_by_seq(a, b) {
    return a.seq - b.seq;
}

function _sort_multiparts_by_create_time(a, b) {
    if (!b.create_time) return 1;
    if (!a.create_time) return -1;
    return b.create_time - a.create_time;
}

function _process_next_parts(parts, context) {
    parts.sort(_sort_parts_by_seq);
    const start_pos = context.pos;
    const start_seq = context.seq;
    for (const part of parts) {
        assert.strictEqual(part.start, context.pos - start_pos);
        assert.strictEqual(part.seq, context.seq - start_seq);
        const len = part.end - part.start;
        const updates = {
            _id: part._id,
            unset_updates: { uncommitted: 1 },
        };
        if (part.seq !== context.seq) {
            updates.set_updates = {
                seq: context.seq,
                start: context.pos,
                end: context.pos + len,
            };
        }
        context.parts_updates.push(updates);
        context.pos += len;
        context.seq += 1;
        context.num_parts += 1;
    }
}



// EXPORTS
exports.select_tier_for_write = select_tier_for_write;
exports.allocate_object_parts = allocate_object_parts;
exports.finalize_object_parts = finalize_object_parts;
exports.complete_object_parts = complete_object_parts;
exports.complete_object_multiparts = complete_object_multiparts;
