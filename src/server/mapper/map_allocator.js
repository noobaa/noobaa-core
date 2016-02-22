'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');
var time_utils = require('../../util/time_utils');
var range_utils = require('../../util/range_utils');
var block_allocator = require('./block_allocator');
var md_store = require('../stores/md_store');
var map_utils = require('./map_utils');

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
        this.check_parts();
        let millistamp = time_utils.millistamp();
        dbg.log1('MapAllocator.run: start');
        return P.join(
                this.find_dups(),
                block_allocator.refresh_bucket_alloc(this.bucket)
            )
            .then(() => this.allocate_blocks())
            .then(() => {
                dbg.log0('MapAllocator.run: DONE. took', time_utils.millitook(millistamp));
                return {
                    parts: this.parts
                };
            })
            .catch(err => {
                dbg.error('MapAllocator.run: ERROR', err.stack || err);
                throw err;
            });
    }

    check_parts() {
        _.each(this.parts, part => {
            // checking that parts size does not exceed the max
            // which allows the read path to limit range scanning
            if (part.end - part.start > config.MAX_OBJECT_PART_SIZE) {
                throw new Error('MapAllocator: PART TOO BIG ' +
                    range_utils.human_range(part));
            }
        });
    }

    find_dups() {
        if (process.env.DEDUP_DISABLED === 'true') return;
        let digest_list = _.uniq(_.map(this.parts, part => part.chunk.digest_b64));
        dbg.log3('MapAllocator.find_dups', digest_list.length);
        return md_store.load_chunks_by_digest(this.bucket, digest_list)
            .then(chunks_by_digest => {
                _.each(this.parts, part => {
                    let dup_chunks = chunks_by_digest[part.chunk.digest_b64];
                    _.each(dup_chunks, dup_chunk => {
                        map_utils.set_chunk_frags_from_blocks(dup_chunk, dup_chunk.blocks);
                        if (map_utils.is_chunk_good(dup_chunk, this.bucket.tiering)) {
                            // we set the part's chunk_dedup to the chunk id
                            // so that the driver will send it back to finalize
                            part.chunk_dedup = dup_chunk._id.toString();
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
            if (part.chunk_dedup) return; // already found dup
            let status = map_utils.get_chunk_status(part.chunk, this.bucket.tiering);
            var avoid_nodes = [];
            _.each(status.allocations, alloc => {
                let f = alloc.fragment;
                let block = _.pick(f,
                    'digest_type',
                    'digest_b64');
                block._id = md_store.make_md_id();
                let node = block_allocator.allocate_node_for_block(
                    block, avoid_nodes, alloc.tier, alloc.pool);
                if (!node) {
                    throw new Error('MapAllocator: no nodes for allocation');
                }
                block.node = node;
                f.blocks = f.blocks || [];
                f.blocks.push(map_utils.get_block_info(block));
                avoid_nodes.push(node._id.toString());
            });
        });
    }

}

module.exports = MapAllocator;
