/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const size_utils = require('../../util/size_utils');
const SystemStore = require('../system_services/system_store');
const system_utils = require('../utils/system_utils');

// TODO: This method is based on a single system
async function background_worker() {
    const target_now = Date.now() - config.MD_GRACE_IN_MILLISECONDS;
    dbg.log0('MD aggregator start running');
    return run_md_aggregator(
        MDStore.instance(),
        SystemStore.get_instance(),
        target_now,
        1000
    );
}

async function run_md_aggregator(md_store, system_store, target_now, delay) {

    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;

    let has_more = true;
    let update_range = true;
    let range = {};

    while (has_more) {
        if (update_range) range = await find_next_range({ target_now, system_store });
        const changes = range && await range_md_aggregator({ md_store, system_store, range });
        if (changes) {
            const update = _.omit(changes, 'more_updates');
            await system_store.make_changes({ update });
            await P.delay(delay);
            update_range = !changes.more_updates;
        } else {
            has_more = false;
        }
    }
    dbg.log0('MD aggregator done');
    return config.MD_AGGREGATOR_INTERVAL;

}

function find_minimal_range({
    target_now,
    system_store,
}) {
    let from_time = target_now;
    let till_time = target_now;
    let should_reset_all = false;

    _.forEach(system_store.data.buckets, bucket => {
        const last_update = _.get(bucket, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
        if (last_update > target_now) {
            dbg.error('find_next_range: time skew detected for bucket', bucket.name,
                'last_update', last_update,
                'target_now', target_now
            );
            should_reset_all = true;
        }
        if (last_update < from_time) {
            till_time = from_time;
            from_time = last_update;
        } else if (from_time < last_update && last_update < till_time) {
            till_time = last_update;
        }
    });
    _.forEach(system_store.data.pools, pool => {
        const last_update = _.get(pool, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
        if (last_update > target_now) {
            dbg.error('find_next_range: time skew detected for pool', pool.name,
                'last_update', last_update,
                'target_now', target_now
            );
            should_reset_all = true;
        }
        if (last_update < from_time) {
            till_time = from_time;
            from_time = last_update;
        } else if (from_time < last_update && last_update < till_time) {
            till_time = last_update;
        }
    });
    return { from_time, till_time, should_reset_all };
}

// find next from_time/till_time of the first group we want to aggregate
function find_next_range({
    target_now,
    system_store,
}) {
    let { from_time, till_time, should_reset_all } = find_minimal_range({
        target_now,
        system_store,
    });
    // printing the range and the buckets/pools relative info
    dbg.log0('find_next_range:',
        'from_time', from_time,
        'till_time*', till_time - from_time,
        'target_now*', target_now - from_time
    );
    _.forEach(system_store.data.buckets, bucket => {
        const last_update = _.get(bucket, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
        dbg.log1('find_next_range: bucket', bucket.name,
            'last_update*', last_update - from_time
        );
    });
    _.forEach(system_store.data.pools, pool => {
        const last_update = _.get(pool, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
        dbg.log1('find_next_range: pool', pool.name,
            'last_update*', last_update - from_time
        );
    });

    if (should_reset_all) {
        dbg.error('find_next_range: reset all storage_stats due to time skews ',
            'from_time', from_time,
            'till_time*', till_time - from_time,
            'target_now*', target_now - from_time
        );
        // Assigning NOOBAA_EPOCH so we will gather all data again till the new time
        // This means that we will be eventually consistent
        return system_store.make_changes({
            update: {
                buckets: _.map(system_store.data.buckets, bucket => ({
                    _id: bucket._id,
                    storage_stats: {
                        last_update: config.NOOBAA_EPOCH,
                        chunks_capacity: 0,
                        blocks_size: 0,
                        objects_size: 0,
                        objects_count: 0,
                        objects_hist: [],
                        pools: {},
                    },
                })),
                pools: _.map(system_store.data.pools, pool => ({
                    _id: pool._id,
                    storage_stats: {
                        last_update: config.NOOBAA_EPOCH,
                        blocks_size: 0,
                    },
                }))
            }
        });
    }

    // on normal operation the time_diff to close can be closed within a single MD_AGGREGATOR_INTERVAL
    // but on upgrades or shutdowns the gap can get higher, and then we limit the number of cycles we
    // allow to run to MD_AGGREGATOR_MAX_CYCLES, and therefore increase the interval from MD_AGGREGATOR_INTERVAL
    // to higher interval in order to close the gap in a reasonable number of cycles.
    const time_diff = till_time - from_time;
    const current_interval = Math.max(
        Math.floor(time_diff / config.MD_AGGREGATOR_MAX_CYCLES),
        config.MD_AGGREGATOR_INTERVAL);
    till_time = Math.min(from_time + current_interval, till_time);

    if (from_time >= target_now || from_time >= till_time) {
        dbg.log0('find_next_range:: no more work',
            'from_time', from_time,
            'till_time*', till_time - from_time,
            'target_now*', target_now - from_time
        );
        return;
    }

    dbg.log0('find_next_range:: next work',
        'from_time', from_time,
        'till_time*', till_time - from_time,
        'target_now*', target_now - from_time
    );
    return { from_time, till_time };
}

function range_md_aggregator({
    md_store,
    system_store,
    range,
}) {
    const from_time = range.from_time;
    const till_time = range.till_time;
    let more_updates = false;

    const filtered_buckets = _.filter(system_store.data.buckets, bucket => bucket.storage_stats.last_update === from_time);
    const filtered_pools = _.filter(system_store.data.pools, pool => pool.storage_stats.last_update === from_time);
    if (filtered_buckets.length > config.MD_AGGREGATOR_BATCH || filtered_pools.length > config.MD_AGGREGATOR_BATCH) {
        more_updates = true;
    }

    const buckets = filtered_buckets.slice(0, config.MD_AGGREGATOR_BATCH);
    const pools = filtered_pools.slice(0, config.MD_AGGREGATOR_BATCH);

    return P.join(
            md_store.aggregate_chunks_by_create_dates(from_time, till_time),
            md_store.aggregate_chunks_by_delete_dates(from_time, till_time),
            md_store.aggregate_objects_by_create_dates(from_time, till_time),
            md_store.aggregate_objects_by_delete_dates(from_time, till_time),
            md_store.aggregate_blocks_by_create_dates(from_time, till_time),
            md_store.aggregate_blocks_by_delete_dates(from_time, till_time)
        )
        .spread((
            existing_chunks_aggregate,
            deleted_chunks_aggregate,
            existing_objects_aggregate,
            deleted_objects_aggregate,
            existing_blocks_aggregate,
            deleted_blocks_aggregate) => {

            dbg.log3('range_md_aggregator:',
                'from_time', from_time,
                'till_time', till_time,
                'existing_objects_aggregate', util.inspect(existing_objects_aggregate, true, null, true),
                'deleted_objects_aggregate', util.inspect(deleted_objects_aggregate, true, null, true),
                'existing_blocks_aggregate', util.inspect(existing_blocks_aggregate, true, null, true),
                'deleted_blocks_aggregate', util.inspect(deleted_blocks_aggregate, true, null, true)
            );

            const buckets_updates = _.map(buckets, bucket => {
                const new_storage_stats = calculate_new_bucket({
                    bucket,
                    existing_chunks_aggregate,
                    deleted_chunks_aggregate,
                    existing_objects_aggregate,
                    deleted_objects_aggregate,
                    existing_blocks_aggregate,
                    deleted_blocks_aggregate
                });
                new_storage_stats.last_update = till_time;
                return {
                    _id: bucket._id,
                    storage_stats: new_storage_stats,
                };
            });

            const pools_updates = _.map(pools, pool => {
                const new_storage_stats = calculate_new_pool({
                    pool,
                    existing_blocks_aggregate,
                    deleted_blocks_aggregate
                });
                new_storage_stats.last_update = till_time;
                return {
                    _id: pool._id,
                    storage_stats: new_storage_stats,
                };
            });

            return {
                buckets: buckets_updates,
                pools: pools_updates,
                more_updates
            };
        });
}

function calculate_new_pool({
    pool,
    existing_blocks_aggregate,
    deleted_blocks_aggregate
}) {
    const new_storage_stats = {
        blocks_size: (pool.storage_stats && pool.storage_stats.blocks_size) || 0,
    };
    dbg.log3('Pool storage stats before deltas:', new_storage_stats);
    const bigint_ex_blocks_agg = size_utils.json_to_bigint((existing_blocks_aggregate.pools[pool._id] &&
        existing_blocks_aggregate.pools[pool._id].size) || 0);
    const bigint_de_blocks_agg = size_utils.json_to_bigint((deleted_blocks_aggregate.pools[pool._id] &&
        deleted_blocks_aggregate.pools[pool._id].size) || 0);
    dbg.log3('Pool storage stats', bigint_ex_blocks_agg, bigint_de_blocks_agg);

    const delta_block_size = bigint_ex_blocks_agg.minus(bigint_de_blocks_agg);

    // If we won't always update the checkpoint, on no changes
    // We will reduce all of the chunks from last checkpoint (which can be a lot)
    new_storage_stats.blocks_size = (size_utils.json_to_bigint(new_storage_stats.blocks_size)
            .plus(delta_block_size))
        .toJSON();

    dbg.log3('Pool storage stats after deltas:', new_storage_stats);
    return new_storage_stats;
}

function calculate_new_bucket({
    bucket,
    existing_chunks_aggregate,
    deleted_chunks_aggregate,
    existing_objects_aggregate,
    deleted_objects_aggregate,
    existing_blocks_aggregate,
    deleted_blocks_aggregate,
}) {
    const new_storage_stats = {
        chunks_capacity: (bucket.storage_stats && bucket.storage_stats.chunks_capacity) || 0,
        objects_size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
        objects_count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0,
        stats_by_content_type: (bucket.storage_stats && bucket.storage_stats.stats_by_content_type) || [],
        blocks_size: (bucket.storage_stats && bucket.storage_stats.blocks_size) || 0,
        pools: (bucket.storage_stats && bucket.storage_stats.pools) || {},
    };

    dbg.log3('Bucket storage stats before deltas:', new_storage_stats);
    const bigint_ex_chunks_agg = size_utils.json_to_bigint((existing_chunks_aggregate[bucket._id] &&
        existing_chunks_aggregate[bucket._id].compress_size) || 0);
    const bigint_de_chunks_agg = size_utils.json_to_bigint((deleted_chunks_aggregate[bucket._id] &&
        deleted_chunks_aggregate[bucket._id].compress_size) || 0);
    const bigint_ex_blocks_agg = size_utils.json_to_bigint((existing_blocks_aggregate.buckets[bucket._id] &&
        existing_blocks_aggregate.buckets[bucket._id].size) || 0);
    const bigint_de_blocks_agg = size_utils.json_to_bigint((deleted_blocks_aggregate.buckets[bucket._id] &&
        deleted_blocks_aggregate.buckets[bucket._id].size) || 0);
    const ex_pools = (existing_blocks_aggregate.buckets[bucket._id] &&
        existing_blocks_aggregate.buckets[bucket._id].pools) || {};
    const de_pools = (deleted_blocks_aggregate.buckets[bucket._id] &&
        deleted_blocks_aggregate.buckets[bucket._id].pools) || {};
    const bigint_ex_obj_agg = size_utils.json_to_bigint((existing_objects_aggregate[bucket._id] &&
        existing_objects_aggregate[bucket._id].size) || 0);
    const bigint_de_obj_agg = size_utils.json_to_bigint((deleted_objects_aggregate[bucket._id] &&
        deleted_objects_aggregate[bucket._id].size) || 0);



    aggregate_by_content_type({
        bucket,
        new_storage_stats,
        existing_objects_aggregate,
        deleted_objects_aggregate
    });

    const delta_chunk_compress_size = bigint_ex_chunks_agg.minus(bigint_de_chunks_agg);
    const delta_block_size = bigint_ex_blocks_agg.minus(bigint_de_blocks_agg);

    const delta_buckets_pool_size = _.mergeWith(ex_pools, de_pools, (ex_value, de_value) => ({
        size: size_utils.json_to_bigint((ex_value && ex_value.size) || 0)
            .minus(size_utils.json_to_bigint((de_value && de_value.size) || 0))
    }));

    const delta_object_size = bigint_ex_obj_agg.minus(bigint_de_obj_agg);
    const delta_object_count = ((existing_objects_aggregate[bucket._id] &&
            existing_objects_aggregate[bucket._id].count) || 0) -
        ((deleted_objects_aggregate[bucket._id] &&
            deleted_objects_aggregate[bucket._id].count) || 0);

    // If we won't always update the checkpoint, on no changes
    // We will reduce all of the chunks from last checkpoint (which can be a lot)
    new_storage_stats.chunks_capacity = size_utils.json_to_bigint(new_storage_stats.chunks_capacity)
        .plus(delta_chunk_compress_size)
        .toJSON();
    new_storage_stats.blocks_size = size_utils.json_to_bigint(new_storage_stats.blocks_size)
        .plus(delta_block_size)
        .toJSON();
    new_storage_stats.pools = _.mergeWith(new_storage_stats.pools, delta_buckets_pool_size, (ex_value, de_value) => ({
        blocks_size: size_utils.json_to_bigint((ex_value && ex_value.blocks_size) || 0)
            .plus(size_utils.json_to_bigint((de_value && de_value.size) || 0))
            .toJSON()
    }));
    new_storage_stats.pools = _.pickBy(new_storage_stats.pools, pool => ((pool && pool.blocks_size) || 0));
    new_storage_stats.objects_size = size_utils.json_to_bigint(new_storage_stats.objects_size)
        .plus(delta_object_size)
        .toJSON();
    new_storage_stats.objects_count += delta_object_count;
    new_storage_stats.objects_hist = build_objects_hist(bucket, existing_objects_aggregate, deleted_objects_aggregate);

    dbg.log3('Bucket storage stats after deltas:', new_storage_stats);
    return new_storage_stats;
}

function aggregate_by_content_type({
    bucket,
    new_storage_stats,
    existing_objects_aggregate,
    deleted_objects_aggregate
}) {
    const ex_by_content_type = existing_objects_aggregate[bucket._id] && existing_objects_aggregate[bucket._id].content_type;
    const de_by_content_type = deleted_objects_aggregate[bucket._id] && deleted_objects_aggregate[bucket._id].content_type;

    let stats_by_content_type_obj = _.keyBy(new_storage_stats.stats_by_content_type, 'content_type');

    if (ex_by_content_type || de_by_content_type) {
        // convert current stats to bigint
        stats_by_content_type_obj = _.mapValues(stats_by_content_type_obj, val => ({
            count: size_utils.json_to_bigint(val.count),
            size: size_utils.json_to_bigint(val.size),
        }));
    }

    if (ex_by_content_type) {
        // add stats of new uploads
        _.mergeWith(stats_by_content_type_obj, ex_by_content_type, (val_bigint, other) => {
            val_bigint = val_bigint || { size: size_utils.BigInteger.zero, count: size_utils.BigInteger.zero };
            const other_bigint = {
                count: size_utils.json_to_bigint(_.get(other, 'count', 0)),
                size: size_utils.json_to_bigint(_.get(other, 'size', 0))
            };
            return {
                count: val_bigint.count.plus(other_bigint.count),
                size: val_bigint.size.plus(other_bigint.size),
            };
        });
    }
    if (de_by_content_type) {
        // decrement stats of deleted objects
        _.mergeWith(stats_by_content_type_obj, de_by_content_type, (val_bigint, other) => {
            val_bigint = val_bigint || { size: size_utils.BigInteger.zero, count: size_utils.BigInteger.zero };
            const other_bigint = {
                count: size_utils.json_to_bigint(_.get(other, 'count', 0)),
                size: size_utils.json_to_bigint(_.get(other, 'size', 0))
            };
            return {
                count: val_bigint.count.minus(other_bigint.count),
                size: val_bigint.size.minus(other_bigint.size),
            };
        });
    }

    // convert back to json
    if (ex_by_content_type || de_by_content_type) {
        new_storage_stats.stats_by_content_type = _.map(stats_by_content_type_obj, (bigint_val, content_type) => ({
            content_type,
            count: bigint_val.count.toJSON(),
            size: bigint_val.size.toJSON(),
        }));
    }

}

function get_hist_array_from_aggregate(agg, key) {
    const key_prefix = key + '_pow2_';
    let bins_arr = [];
    for (var prop in agg) {
        if (prop.startsWith(key_prefix)) {
            let index = parseInt(prop.replace(key_prefix, ''), 10);
            bins_arr[index] = agg[prop];
        }
    }
    return bins_arr;
}

function build_objects_hist(bucket, existing_agg, deleted_agg) {
    // get the current histogram from DB
    let current_objects_hist = (bucket.storage_stats && bucket.storage_stats.objects_hist) || [];

    // get the latest additions\deletions in an array form
    let existing_size_hist = get_hist_array_from_aggregate(existing_agg[bucket._id], 'size');
    let deleted_size_hist = get_hist_array_from_aggregate(deleted_agg[bucket._id], 'size');
    let existing_count_hist = get_hist_array_from_aggregate(existing_agg[bucket._id], 'count');
    let deleted_count_hist = get_hist_array_from_aggregate(deleted_agg[bucket._id], 'count');

    // size and count should have the same length, since they are emitted together in mongo mapreduce
    if (deleted_size_hist.length !== deleted_count_hist.length ||
        existing_size_hist.length !== existing_count_hist.length) {
        dbg.error('size histogram and count histogram have different lengths',
            'deleted_size_hist.length =', deleted_size_hist.length,
            'deleted_count_hist.length =', deleted_count_hist.length,
            'existing_size_hist.length =', existing_size_hist.length,
            'existing_count_hist.length =', existing_count_hist.length);
    }

    let num_bins = Math.max(deleted_size_hist.length, existing_size_hist.length, current_objects_hist.length);
    if (num_bins === 0) return current_objects_hist;
    let new_size_hist = [];
    for (var i = 0; i < num_bins; i++) {
        let bin = {
            label: (current_objects_hist[i] && current_objects_hist[i].label) || get_hist_label(i),
            aggregated_sum: get_new_bin(
                existing_size_hist[i] || 0,
                deleted_size_hist[i] || 0,
                (current_objects_hist[i] && current_objects_hist[i].aggregated_sum) || 0),
            count: get_new_bin(
                existing_count_hist[i] || 0,
                deleted_count_hist[i] || 0,
                (current_objects_hist[i] && current_objects_hist[i].count) || 0)
        };
        new_size_hist.push(bin);
    }

    return new_size_hist;
}

function get_hist_label(pow) {
    if (pow === 0) {
        return "0 - " + size_utils.human_size(1);
    }
    return `${size_utils.human_size(Math.pow(2, pow - 1))} - ${size_utils.human_size(Math.pow(2, pow))}`;
}

function get_new_bin(existing, deleted, current) {
    if (!existing && !deleted) {
        return current;
    }
    let bigint_existing_size_bin = size_utils.json_to_bigint(existing);
    let bigint_deleted_size_bin = size_utils.json_to_bigint(deleted);
    let delta_size_bin = bigint_existing_size_bin
        .minus(bigint_deleted_size_bin);
    let new_bin = size_utils.json_to_bigint(current)
        .plus(delta_size_bin)
        .toJSON();
    return new_bin;
}


// EXPORTS
exports.background_worker = background_worker;
exports.run_md_aggregator = run_md_aggregator;
exports.calculate_new_bucket = calculate_new_bucket;
exports.calculate_new_pool = calculate_new_pool;
exports.find_minimal_range = find_minimal_range;
