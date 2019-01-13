/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const mapper = require('../object_services/mapper');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();

const { BigInteger } = size_utils;

function aggregate_data_free_by_tier(req) {
    let available_by_tiers = [];

    return P.each(req.rpc_params.tier_ids, tier_id => _aggregate_data_free_for_tier(tier_id, req.system)
            .then(available_storage => {
                available_by_tiers.push({
                    tier_id: tier_id,
                    mirrors_storage: available_storage
                });
            })
            .catch(err => {
                console.error(`Error getting available to upload of tier: ${tier_id}`, err);
            }))
        .return(available_by_tiers);
}


function _aggregate_data_free_for_tier(tier_id, system) {
    const mirror_available_storage = [];
    const tier = system_store.data.get_by_id(tier_id);

    if (!tier) {
        const err = new Error(`Tier ${tier_id} was not found`);
        console.error(err);
        return P.reject(err);
    }
    const num_blocks_per_chunk = mapper.get_num_blocks_per_chunk(tier);

    return P.each(tier.mirrors, mirror_object => server_rpc.client.node.list_nodes({
                query: {
                    pools: mirror_object.spread_pools.map(pool => pool.name) || undefined,
                },
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin'
                })
            })
            .then(res_nodes => {
                let redundant_free = BigInteger.zero;
                const spread_free = [];
                for (let i = 0; i < res_nodes.nodes.length; ++i) {
                    const node = res_nodes.nodes[i];
                    const node_free = size_utils.json_to_bigint(node.storage.free || 0);
                    if (!node_free.greater(BigInteger.zero)) continue;
                    if (node.is_cloud_node || node.is_mongo_node) {
                        redundant_free = redundant_free.plus(node_free);
                    } else {
                        spread_free.push(node_free);
                    }
                }
                let regular_free = _calculate_spread_free(spread_free, num_blocks_per_chunk);
                let free = regular_free.plus(redundant_free);
                mirror_available_storage.push({
                    free: size_utils.bigint_to_json(free),
                    redundant_free: size_utils.bigint_to_json(redundant_free),
                    regular_free: size_utils.bigint_to_json(regular_free),
                });
            }))
        .return(mirror_available_storage);
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
