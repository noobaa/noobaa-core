/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const assert = require('assert');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const time_utils = require('../../util/time_utils');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const map_writer = require('./map_writer');
const PeriodicReporter = require('../../util/periodic_reporter');

const map_instructor_reporter = new PeriodicReporter('map_instructor_reporter');

/**
 * 
 * MapInstructor
 * 
 * TODO:
 * - find_dups
 * - location_info
 * - alloc.sources?
 * 
 */
class MapInstructor {

    constructor(chunks, location_info, move_to_tier) {
        this.chunks = chunks;
        this.location_info = location_info;
        this.move_to_tier = move_to_tier;
    }

    async run() {
        const millistamp = time_utils.millistamp();
        dbg.log1('MapInstructor: start');
        try {
            await this.do_allocations();
            dbg.log0('MapInstructor: DONE. parts', this.parts.length,
                'took', time_utils.millitook(millistamp));
            return this.chunks;
        } catch (err) {
            dbg.error('MapInstructor: ERROR', err.stack || err);
            throw err;
        }
    }

    async do_allocations() {
        const chunks_per_bucket = _.groupBy(this.chunks, 'bucket');
        // assert move_to_tier is only used for chunks on the same bucket
        if (this.move_to_tier) assert.strictEqual(Object.keys(chunks_per_bucket).length, 1);
        await P.map(chunks_per_bucket, async (chunks, bucket_id) => {
            const bucket = system_store.data.get_by_id(bucket_id);
            const total_size = _.sumBy(chunks, 'size');
            let tier_for_write = await this.prepare_chunks_group(chunks, bucket);
            let done = false;
            while (!done) {
                const start_alloc_time = Date.now();
                const has_room = map_writer.enough_room_in_tier(tier_for_write, bucket);
                done = await this.allocate_chunks(chunks, has_room ? '' : 'preallocate');
                map_instructor_reporter.add_event(`allocate_chunks(${tier_for_write.name})`, total_size, Date.now() - start_alloc_time);
                if (!done) {
                    await map_writer.ensure_room_in_tier(tier_for_write, bucket);
                    // TODO Decide if we want to update the chunks mappings when looping
                    // tier_for_write = await this.prepare_chunks_group(chunks, bucket);
                }
            }
        });
    }

    async prepare_chunks_group(chunks, bucket) {
        await node_allocator.refresh_tiering_alloc(bucket.tiering);
        const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
        const tier_for_write = this.move_to_tier || mapper.select_tier_for_write(bucket.tiering, tiering_status);
        for (const chunk of chunks) {
            // We must set the tier id for the mapper to get the tier reference
            // BUT, after the mapper we restore the tier name for the reply schema check to pass
            chunk.tier = tier_for_write._id;
            chunk.mapping = mapper.map_chunk(chunk, tier_for_write, bucket.tiering, tiering_status, this.location_info);
            chunk.tier = tier_for_write.name;
        }
        return tier_for_write;
    }

    async allocate_chunks(chunks, preallocate) {
        for (const chunk of chunks) {
            const done = await this.allocate_chunk(chunk, preallocate);
            if (!done) return false;
        }
        return true;
    }

    async allocate_chunk(chunk, preallocate) {
        const mapping = chunk.mapping;
        const avoid_blocks = chunk.blocks.filter(block => block.node.node_type === 'BLOCK_STORE_FS');
        const avoid_nodes = avoid_blocks.map(block => String(block.node._id));
        const allocated_hosts = avoid_blocks.map(block => block.node.host_id);

        for (const frag of chunk.frags) {
            frag.blocks = [];
        }

        // const mapping = mapper.map_chunk(chunk, tier_for_write, bucket.tiering, tiering_status, location_info);
        // const chunk_info = mapping.missing_frags && await map_writer.read_entire_chunk(chunk);

        for (const alloc of mapping.allocations) {
            const { frag, pools, /* sources */ } = alloc;
            // let source_block_info;
            // if (sources) {
            //     const source_block = sources.accessible_blocks[sources.next_source];
            //     sources.next_source = (sources.next_source + 1) % sources.accessible_blocks.length;
            //     source_block_info = mapper.get_block_md(chunk, frag, source_block);
            // }
            const node = node_allocator.allocate_node(pools, avoid_nodes, allocated_hosts);
            if (!node) {
                dbg.warn(`MapInstructor allocate_blocks: no nodes for allocation ` +
                    `avoid_nodes ${avoid_nodes.join(',')} ` +
                    `pools ${pools.join(',')} ` +
                    `tier_for_write ${this.tier_for_write.name} ` +
                    `tiering_status ${util.inspect(this.tiering_status, { depth: null })} `);
                // chunk.frags = saved_frags;
                return false;
            }
            const block = {
                _id: MDStore.instance().make_md_id(),
            };
            mapper.assign_node_to_block(block, node, chunk.system._id);
            const block_info = mapper.get_block_info(chunk, frag, block);
            if (preallocate === 'preallocate') {
                try {
                    const prealloc_md = { ...block_info.block_md, digest_type: undefined, digest_b64: undefined, size: chunk.frag_size };
                    await server_rpc.client.block_store.preallocate_block({
                        block_md: prealloc_md,
                    }, {
                        address: prealloc_md.address,
                        timeout: config.IO_REPLICATE_BLOCK_TIMEOUT,
                        auth_token: auth_server.make_auth_token({
                            system_id: chunk.system,
                            role: 'admin',
                        })
                    });
                    block_info.block_md.preallocated = true;
                } catch (err) {
                    dbg.warn('MapInstructor: preallocate_blocks failed, will retry',
                        `avoid_nodes ${avoid_nodes.join(',')} ` +
                        `pools ${pools.join(',')} ` +
                        `tier_for_write ${this.tier_for_write.name} ` +
                        `tiering_status ${util.inspect(this.tiering_status, { depth: null })} `);
                    return false;
                }
            }
            alloc.block = block_info;
            if (node.node_type === 'BLOCK_STORE_FS') {
                avoid_nodes.push(String(node._id));
                allocated_hosts.push(node.host_id);
            }
        }

        // TODO sort allocations by location_info
        // frag.blocks = frag.blocks || [];
        // if (location_info && // optimizing local nodes/hosts - so it will be used for write rather than for replication 
        //     (location_info.host_id === node.host_id || location_info.node_id === String(node._id))) {
        //     frag.blocks.unshift(block_info);
        // } else {
        //     frag.blocks.push(block_info);
        // }
    }

}

exports.MapInstructor = MapInstructor;
