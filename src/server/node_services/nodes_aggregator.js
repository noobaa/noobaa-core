/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const dbg = require('../../util/debug_module')(__filename);
const mapper = require('../object_services/mapper');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();

const { BigInteger } = size_utils;

async function aggregate_data_free_by_tier(req) {
    const tiers = [];
    const pool_set = new Set();

    for (const tier_id of req.rpc_params.tier_ids) {
        const tier = system_store.data.get_by_id(tier_id);
        if (!tier) {
            continue;
        }

        tiers.push(tier);
        for (const mirror of tier.mirrors) {
            for (const pool of mirror.spread_pools) {
                pool_set.add(String(pool.name));
            }
        }
    }

    const { nodes } = await server_rpc.client.node.list_nodes({
        query: {
            pools: [...pool_set],
        },
    }, {
        auth_token: req.auth_token
    });

    const nodes_by_pool = _.groupBy(nodes, node => node.pool);
    return Promise.all(
        tiers.map(async tier => {
            const tier_id = String(tier._id);
            try {
                const mirrors_storage = await _aggregate_data_free_for_tier(tier, nodes_by_pool);
                return { tier_id, mirrors_storage };

            } catch (err) {
                console.error(`Error getting available to upload of tier: ${tier_id}`, err);
            }
        })
    );
}

function _aggregate_data_free_for_tier(tier, nodes_by_pool) {
    const num_blocks_per_chunk = mapper.get_num_blocks_per_chunk(tier);
    return tier.mirrors.map(({ spread_pools }) => {
        const nodes = _.flatMap(spread_pools, pool => nodes_by_pool[pool.name] || []);
        let redundant_free = BigInteger.zero;
        const spread_free = [];
        for (const node of nodes) {
            const node_free = size_utils.json_to_bigint(node.storage.free || 0);
            if (!node_free.greater(BigInteger.zero)) continue;
            if (node.is_cloud_node || node.is_mongo_node) {
                redundant_free = redundant_free.plus(node_free);
            } else {
                spread_free.push(node_free);
            }
        }
        const regular_free = _calculate_spread_free(spread_free, num_blocks_per_chunk);
        const free = regular_free.plus(redundant_free);

        return {
            free: size_utils.bigint_to_json(free),
            redundant_free: size_utils.bigint_to_json(redundant_free),
            regular_free: size_utils.bigint_to_json(regular_free),
        };
    });
}


function compare_bigint(bigint_a, bigint_b) {
    return bigint_a.compare(bigint_b);
}


/**
 * @param {BigInteger[]} free_list Array of free storage per node
 * @param {number} num_blocks_per_chunk The number of blocks including replicas and parity in the tier policy
 */
function _calculate_spread_free(free_list, num_blocks_per_chunk) {
    free_list.sort(compare_bigint);
    let total = BigInteger.zero;
    while (free_list.length >= num_blocks_per_chunk) {
        const smallest = free_list.shift();
        total = total.plus(smallest);
        for (let i = 0; i < num_blocks_per_chunk - 1; ++i) {
            free_list[i] = free_list[i].minus(smallest);
        }
    }
    return total;
}


exports.aggregate_data_free_by_tier = aggregate_data_free_by_tier;
