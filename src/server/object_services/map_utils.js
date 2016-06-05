'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const md_store = require('./md_store');
const nodes_store = require('../node_services/nodes_store').get_instance();
const system_store = require('../system_services/system_store').get_instance();
// const js_utils = require('../../util/js_utils');

const EMPTY_CONST_ARRAY = Object.freeze([]);
const SPECIAL_CHUNK_CONTENT_TYPES = ['video/mp4', 'video/webm'];
const SPECIAL_CHUNK_REPLICA_MULTIPLIER = 2;

function analyze_special_chunks(chunks, parts, objects) {
    _.forEach(chunks, chunk => {
        chunk.is_special = false;
        var tmp_parts = _.filter(parts, part => String(part.chunk) === String(chunk._id));
        var tmp_objects = _.filter(objects, obj => _.find(tmp_parts, part => String(part.obj) === String(obj._id)));
        _.forEach(tmp_objects, obj => {
            if (_.includes(SPECIAL_CHUNK_CONTENT_TYPES, obj.content_type)) {
                let obj_parts = _.filter(tmp_parts, part => String(part.obj) === String(obj._id));
                _.forEach(obj_parts, part => {
                    if (part.start === 0 || part.end === obj.size) {
                        chunk.is_special = true;
                    }
                });
            }
        });
    });
}


function select_prefered_pools(tier) {
    // first filter out cloud_pools.
    let regular_pools = tier.pools.filter(pool => _.isUndefined(pool.cloud_pool_info));

    // from the regular pools we should select the best pool
    // for now we just take the first pool in the list.
    if (tier.data_placement === 'MIRROR') {
        if (!regular_pools[0]) {
            throw new Error('could not find a pool for async mirroring');
        }
        return [regular_pools[0]];
    } else {
        return regular_pools;
    }

}

function get_chunk_status(chunk, tiering, async_mirror) {
    // TODO handle multi-tiering
    if (tiering.tiers.length !== 1) {
        throw new Error('analyze_chunk: ' +
            'tiering policy must have exactly one tier and not ' +
            tiering.tiers.length);
    }
    const tier = tiering.tiers[0].tier;
    // when allocating blocks for upload we want to ignore cloud_pools
    // so the client is not blocked until all blocks are uploded to the cloud.
    // on build_chunks flow we will not ignore cloud pools.
    const participating_pools = async_mirror ?
        select_prefered_pools(tier) :
        tier.pools;
    const tier_pools_by_id = _.keyBy(participating_pools, '_id');
    var replicas = chunk.is_special ? tier.replicas * SPECIAL_CHUNK_REPLICA_MULTIPLIER : tier.replicas;
    const now = Date.now();

    let allocations = [];
    let deletions = [];
    let chunk_accessible = true;

    let missing_frags = get_missing_frags_in_chunk(chunk, tier);
    if (missing_frags && missing_frags.length) {
        // for now just log the error and mark as not accessible,
        // but no point in throwing as the caller
        // will not know how to handle and what is wrong
        console.error('get_chunk_status: missing fragments', chunk, missing_frags);
        chunk_accessible = false;
    }

    function check_blocks_group(blocks, alloc) {
        let required_replicas = replicas;
        if (alloc && alloc.pools && alloc.pools[0].cloud_pool_info) {
            // for cloud_pools we only need one replica
            required_replicas = 1;
        }
        let num_good = 0;
        let num_accessible = 0;
        _.each(blocks, block => {
            if (is_block_accessible(block, now)) {
                num_accessible += 1;
            }
            if (num_good < required_replicas &&
                is_block_good(block, now, tier_pools_by_id)) {
                num_good += 1;
            } else {
                deletions.push(block);
            }
        });
        if (alloc) {
            let num_missing = Math.max(0, required_replicas - num_good);
            _.times(num_missing, () => allocations.push(_.clone(alloc)));
        }
        return num_accessible;
    }


    _.each(chunk.frags, f => {

        dbg.log1('get_chunk_status:', 'chunk', chunk, 'fragment', f);

        let blocks = f.blocks || EMPTY_CONST_ARRAY;
        let num_accessible = 0;


        // mirror blocks between the given pools.
        // if necessary remove blocks from already mirrored blocks
        function mirror_pools(mirrored_pools, mirrored_blocks) {
            let blocks_by_pool = _.groupBy(mirrored_blocks, block => block.node.pool);
            _.each(mirrored_pools, pool => {
                num_accessible += check_blocks_group(blocks_by_pool[pool._id], {
                    pools: [pool],
                    fragment: f
                });
                delete blocks_by_pool[pool._id];
            });
            _.each(blocks_by_pool, blocks => check_blocks_group(blocks, null));
        }

        if (tier.data_placement === 'MIRROR') {
            mirror_pools(participating_pools, blocks);
        } else { // SPREAD
            let pools_partitions = _.partition(participating_pools, pool => _.isUndefined(pool.cloud_pool_info));
            let blocks_partitions = _.partition(blocks, block => !block.node.is_cloud_node);
            let regular_pools = pools_partitions[0];
            let regular_blocks = blocks_partitions[0];
            num_accessible += check_blocks_group(regular_blocks, {
                pools: regular_pools, // only spread data on regular pools, and not cloud_pools
                fragment: f
            });

            // cloud pools are always used for mirroring.
            // if there are any cloud pools or blocks written to cloud pools, handle them
            let cloud_pools = pools_partitions[1];
            let cloud_blocks = blocks_partitions[1];
            if (cloud_pools.length || cloud_blocks.length) {
                mirror_pools(cloud_pools, cloud_blocks);
            }
        }

        if (!num_accessible) {
            chunk_accessible = false;
        }
    });

    return {
        allocations: allocations,
        deletions: deletions,
        accessible: chunk_accessible,
    };
}

function set_chunk_frags_from_blocks(chunk, blocks) {
    let blocks_by_frag_key = _.groupBy(blocks, get_frag_key);
    chunk.frags = _.map(blocks_by_frag_key, blocks => {
        let f = _.pick(blocks[0],
            'layer',
            'layer_n',
            'frag',
            'size',
            'digest_type',
            'digest_b64');
        // sorting the blocks to have most available node on front
        // TODO add load balancing (maybe random the order of good blocks)
        // TODO need stable sorting here for parallel decision making...
        blocks.sort(block_access_sort);
        f.blocks = blocks;
        return f;
    });
}

function get_missing_frags_in_chunk(chunk, tier) {
    let missing_frags;
    let fragments_by_frag_key = _.keyBy(chunk.frags, get_frag_key);
    // TODO handle parity fragments
    _.times(tier.data_fragments, frag => {
        let f = {
            layer: 'D',
            frag: frag,
        };
        let frag_key = get_frag_key(f);
        if (!fragments_by_frag_key[frag_key]) {
            missing_frags = missing_frags || [];
            missing_frags.push(f);
        }
    });
    return missing_frags;
}

function is_block_good(block, now, tier_pools_by_id) {
    if (!is_block_accessible(block, now)) {
        return false;
    }
    // detect nodes that do not belong to the tier pools
    // to be deleted once they are not needed as source
    if (!tier_pools_by_id[block.node.pool]) {
        return false;
    }


    // detect nodes that are full in terms of free space policy
    // to be deleted once they are not needed as source
    if (block.node.storage.limit) {
        if (block.node.storage.limit <= block.node.storage.used) {
            return false;
        }
    } else if (block.node.storage.free <= config.NODES_FREE_SPACE_RESERVE) {
        return false;
    }


    return true;
}

function is_block_accessible(block, now) {
    var since_hb = now - block.node.heartbeat.getTime();
    if (since_hb > config.SHORT_GONE_THRESHOLD ||
        since_hb > config.LONG_GONE_THRESHOLD) {
        return false;
    }
    if (block.node.srvmode &&
        block.node.srvmode !== 'decommissioning') {
        return false;
    }
    return true;
}

function is_chunk_good(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering, /*async_mirror=*/ false);
    return status.accessible && !status.allocations.length;
}

function is_chunk_accessible(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering, /*async_mirror=*/ false);
    return status.accessible;
}


function get_part_info(part, adminfo) {
    let p = _.pick(part,
        'start',
        'end',
        'part_sequence_number',
        'upload_part_number',
        'chunk_offset');
    p.chunk = get_chunk_info(part.chunk, adminfo);
    return p;
}

function get_chunk_info(chunk, adminfo) {
    let c = _.pick(chunk,
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
    c.frags = _.map(chunk.frags, f => get_frag_info(f, adminfo));
    if (adminfo) {
        c.adminfo = {};
        let bucket = system_store.data.get_by_id(chunk.bucket);
        let status = get_chunk_status(chunk, bucket.tiering, /*async_mirror=*/ false);
        if (!status.accessible) {
            c.adminfo.health = 'unavailable';
        } else if (status.allocations.length) {
            c.adminfo.health = 'building';
        } else {
            c.adminfo.health = 'available';
        }
    }
    return c;
}


function get_frag_info(fragment, adminfo) {
    let f = _.pick(fragment,
        'layer',
        'layer_n',
        'frag',
        'size',
        'digest_type',
        'digest_b64');
    f.blocks = _.map(fragment.blocks, block => get_block_info(block, adminfo));
    return f;
}


function get_block_info(block, adminfo) {
    var ret = {
        block_md: get_block_md(block),
    };
    var node = block.node;
    if (adminfo) {
        var pool = system_store.data.get_by_id(node.pool);
        ret.adminfo = {
            pool_name: pool.name,
            node_name: node.name,
            node_ip: node.ip,
            online: nodes_store.is_online_node(node),
        };
    }
    return ret;
}

function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = block._id.toString();
    b.address = block.node.rpc_address;
    b.node = block.node._id.toString();
    return b;
}

function get_frag_key(f) {
    return f.layer + f.frag;
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
    return P.when(md_store.ObjectPart.collection.find({
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


/**
 * sorting function for sorting blocks with most recent heartbeat first
 */
function block_access_sort(block1, block2) {
    if (block1.node.srvmode) {
        return 1;
    }
    if (block2.node.srvmode) {
        return -1;
    }
    return block2.node.heartbeat.getTime() - block1.node.heartbeat.getTime();
}


// EXPORTS
exports.get_chunk_status = get_chunk_status;
exports.set_chunk_frags_from_blocks = set_chunk_frags_from_blocks;
exports.get_missing_frags_in_chunk = get_missing_frags_in_chunk;
exports.is_block_good = is_block_good;
exports.is_block_accessible = is_block_accessible;
exports.is_chunk_good = is_chunk_good;
exports.is_chunk_accessible = is_chunk_accessible;
exports.get_part_info = get_part_info;
exports.get_chunk_info = get_chunk_info;
exports.get_frag_info = get_frag_info;
exports.get_block_info = get_block_info;
exports.get_block_md = get_block_md;
exports.get_frag_key = get_frag_key;
exports.sanitize_object_range = sanitize_object_range;
exports.find_consecutive_parts = find_consecutive_parts;
exports.block_access_sort = block_access_sort;
exports.analyze_special_chunks = analyze_special_chunks;