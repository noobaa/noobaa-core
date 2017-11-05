/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const size_utils = require('../../util/size_utils');
const system_store = require('../system_services/system_store').get_instance();
const BigInteger = size_utils.BigInteger;


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
    let mirror_available_storage = [];
    let tier = system_store.data.get_by_id(tier_id);

    if (!tier) {
        let err = new Error(`Tier ${tier_id} was not found`);
        console.error(err);
        return P.reject(err);
    }

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
                const on_prem_storage = res_nodes.nodes
                    .filter(node => !node.is_cloud_node && !node.is_mongo_node)
                    .map(node => node.storage);
                const on_mongo_or_cloud_storage = res_nodes.nodes
                    .filter(node => node.is_cloud_node || node.is_mongo_node)
                    .map(node => node.storage);

                mirror_available_storage.push({
                    free: size_utils.reduce_sum('free', _.concat(
                        on_mongo_or_cloud_storage.map(storage => (storage.free || 0)),
                        calculate_total_spread_storage(on_prem_storage, tier.replicas, 'free')
                    ))
                });
            }))
        .return(mirror_available_storage);
}


function compare_bigint(bigint_a, bigint_b) {
    return bigint_a.compare(bigint_b);
}


/**
 * storage_arr - array of storage records
 * replicas - the number of replicas in the tier policy
 * key_to_sort - key of storage record that is required to work on
 */
function calculate_total_spread_storage(storage_arr, replicas, key_to_sort) {
    let key_storage_array = storage_arr.map(storage_obj =>
            size_utils.json_to_bigint(storage_obj[key_to_sort] || 0))
        .filter(big_int_size => big_int_size.greater(BigInteger.zero));

    key_storage_array.sort(compare_bigint);

    let requested_key_total = BigInteger.zero;

    while (key_storage_array.length >= replicas) {
        const smallest = key_storage_array.shift();
        requested_key_total = requested_key_total.plus(smallest);

        for (let i = 0; i < replicas - 1; ++i) {
            key_storage_array[i] = key_storage_array[i].minus(smallest);
        }
    }

    return requested_key_total.toJSON();
}


exports.aggregate_data_free_by_tier = aggregate_data_free_by_tier;
