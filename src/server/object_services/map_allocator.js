/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const MDStore = require('../object_services/md_store').MDStore;
const map_utils = require('./map_utils');
const time_utils = require('../../util/time_utils');
const range_utils = require('../../util/range_utils');
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

    run() {
        let millistamp = time_utils.millistamp();
        dbg.log1('MapAllocator: start');
        return P.resolve()
            .then(() => node_allocator.refresh_tiering_alloc(this.bucket.tiering))
            .then(() => this.check_parts())
            .then(tiering_status => this.find_dups(tiering_status))
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

    check_parts() {
        const tiering_status = node_allocator.get_tiering_status(this.bucket.tiering);
        _.each(this.parts, part => {

            // checking that parts size does not exceed the max
            // which allows the read path to limit range scanning - see map_reader.js
            if (part.end - part.start > config.MAX_OBJECT_PART_SIZE) {
                throw new Error('MapAllocator: PART TOO BIG ' +
                    range_utils.human_range(part));
            }

            part.chunk.status = map_utils.get_chunk_status(
                part.chunk,
                this.bucket.tiering, {
                    async_mirror: true,
                    tiering_status: tiering_status
                });
        });
        return tiering_status;
    }

    find_dups(tiering_status) {
        if (!config.DEDUP_ENABLED) return;
        let digest_list = _.uniq(_.map(this.parts, part => part.chunk.digest_b64));
        dbg.log3('MapAllocator.find_dups', digest_list.length);
        return MDStore.instance().find_chunks_by_digest(this.bucket, digest_list)
            .then(chunks_by_digest => {
                _.each(this.parts, part => {
                    let dup_chunks = chunks_by_digest[part.chunk.digest_b64];
                    _.each(dup_chunks, dup_chunk => {
                        map_utils.set_chunk_frags_from_blocks(dup_chunk, dup_chunk.blocks);
                        if (map_utils.is_chunk_good_for_dedup(dup_chunk,
                                this.bucket.tiering, tiering_status)) {
                            // we set the part's chunk_id so that the client will send it back to finalize
                            part.chunk_id = String(dup_chunk._id);
                            delete part.chunk;
                            // returning explicit false to break from _.each
                            return false;
                        }
                    });
                });
            });
    }

    allocate_blocks() {
        _.each(this.parts, part => {
            if (part.chunk_id) return; // already found dup
            const status = part.chunk.status;
            var avoid_nodes = [];
            let allocated_hosts = [];

            _.each(status.allocations, alloc => {
                let f = alloc.fragment;
                let block = _.pick(f,
                    'digest_type',
                    'digest_b64');
                block._id = MDStore.instance().make_md_id();
                let node = node_allocator.allocate_node(alloc.pools, avoid_nodes, allocated_hosts);
                if (!node) {
                    throw new Error('MapAllocator: no nodes for allocation');
                }
                map_utils.assign_node_to_block(block, node, this.bucket.system._id);
                f.blocks = f.blocks || [];
                f.blocks.push(map_utils.get_block_info(block));
                avoid_nodes.push(String(node._id));
                allocated_hosts.push(node.host_id);
            });

            // This is done so we won't break the RPC Schema
            // Since the parts are returned at the end of the map_allocator
            delete part.chunk.status;
        });
    }

}

exports.MapAllocator = MapAllocator;
