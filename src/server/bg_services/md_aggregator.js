/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const size_utils = require('../../util/size_utils');
const BigInteger = size_utils.BigInteger;
const system_store = require('../system_services/system_store').get_instance();

const SECONDS_IN_DAY = 86400;
const WORKER_INTERVAL_IN_SECONDS = config.MD_AGGREGATOR_INTERVAL / 1000;
const JUMP_ALLOWANCE = (SECONDS_IN_DAY / WORKER_INTERVAL_IN_SECONDS);

// TODO: This method is based on a single system
function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    const target_now = Date.now() - config.MD_GRACE_IN_MILLISECONDS;

    let bucket_groups_by_update_time =
        _.groupBy(system_store.data.buckets, g_bucket =>
            _.get(g_bucket, 'storage_stats.last_update', config.NOOBAA_EPOCH));

    const sorted_group_update_times = _.keysIn(bucket_groups_by_update_time)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (_.isEmpty(bucket_groups_by_update_time)) {
        dbg.log0('md_aggregator: There are no groups to work on');
        return P.resolve();
    }

    return P.each(sorted_group_update_times, (group_update_date, group_index, length) => {
            const is_last_group = Boolean(group_index === (length - 1));
            const current_group = bucket_groups_by_update_time[group_update_date];
            let group_finished = false;
            let from_date = parseInt(group_update_date, 10);
            const next_group_from_date = is_last_group ? target_now :
                parseInt(sorted_group_update_times[group_index + 1], 10);
            const time_diff = next_group_from_date - from_date;
            const date_delta = Math.max(Math.floor(time_diff / JUMP_ALLOWANCE) || time_diff, config.MD_AGGREGATOR_INTERVAL);

            return promise_utils.pwhile(
                    () => !group_finished,
                    () => {
                        const till_date = Math.min(from_date + date_delta, next_group_from_date);
                        return group_md_aggregator(
                                from_date,
                                till_date,
                                current_group,
                                target_now
                            )
                            .then(bucket_updates => {
                                from_date = till_date;
                                current_group.forEach(bucket => {
                                    bucket.storage_stats = _.find(
                                        bucket_updates,
                                        obj => String(obj._id) === String(bucket._id)
                                    ).storage_stats;
                                });

                                if (from_date === next_group_from_date) {
                                    group_finished = true;
                                }
                            });
                    })
                .then(() => {
                    // On the last group the aggregation not needed since there is no more work
                    if (!is_last_group) {
                        // The buckets inside the groups are unique so I'm not worried that I will have an overwrite
                        bucket_groups_by_update_time[sorted_group_update_times[group_index + 1]] =
                            _.concat(bucket_groups_by_update_time[sorted_group_update_times[group_index + 1]], current_group);
                    }
                })
                .catch(err => {
                    console.error(`MD AGGREGATOR: Group aggregation ${util.inspect(_.map(current_group,
                            bucket => ({
                                bucket_id: bucket._id,
                                storage: bucket.storage_stats
                            })), false, null, true)} had an error`, err);
                });
        })
        .return();
}


function group_md_aggregator(from_time, till_time, group_to_aggregate, current_time) {
    return check_time_conditions(from_time, till_time, group_to_aggregate, current_time)
        .then(function() {
            const from_date = new Date(from_time);
            const till_date = new Date(till_time);
            return P.join(
                MDStore.instance().aggregate_chunks_by_create_dates(from_date, till_date),
                MDStore.instance().aggregate_chunks_by_delete_dates(from_date, till_date),
                MDStore.instance().aggregate_objects_by_create_dates(from_date, till_date),
                MDStore.instance().aggregate_objects_by_delete_dates(from_date, till_date),
                MDStore.instance().aggregate_blocks_by_create_dates(from_date, till_date),
                MDStore.instance().aggregate_blocks_by_delete_dates(from_date, till_date)
            ).spread(function(
                existing_chunks_aggregate,
                deleted_chunks_aggregate,
                existing_objects_aggregate,
                deleted_objects_aggregate,
                existing_blocks_aggregate,
                deleted_blocks_aggregate) {
                const bucket_updates = _.map(group_to_aggregate, bucket => {
                    const new_storage_stats = {
                        chunks_capacity: (bucket.storage_stats && bucket.storage_stats.chunks_capacity) || 0,
                        objects_size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
                        objects_count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0,
                        blocks_size: (bucket.storage_stats && bucket.storage_stats.blocks_size) || 0,
                        last_update: till_time,
                    };
                    dbg.log3('Bucket storage stats before deltas:', new_storage_stats);
                    const bigint_ex_chunks_agg = new BigInteger((existing_chunks_aggregate[bucket._id] &&
                        existing_chunks_aggregate[bucket._id].compress_size) || 0);
                    const bigint_de_chunks_agg = new BigInteger((deleted_chunks_aggregate[bucket._id] &&
                        deleted_chunks_aggregate[bucket._id].compress_size) || 0);
                    const bigint_ex_blocks_agg = new BigInteger((existing_blocks_aggregate[bucket._id] &&
                        existing_blocks_aggregate[bucket._id].size) || 0);
                    const bigint_de_blocks_agg = new BigInteger((deleted_blocks_aggregate[bucket._id] &&
                        deleted_blocks_aggregate[bucket._id].size) || 0);
                    const bigint_ex_obj_agg = new BigInteger((existing_objects_aggregate[bucket._id] &&
                        existing_objects_aggregate[bucket._id].size) || 0);
                    const bigint_de_obj_agg = new BigInteger((deleted_objects_aggregate[bucket._id] &&
                        deleted_objects_aggregate[bucket._id].size) || 0);

                    const delta_chunk_compress_size = bigint_ex_chunks_agg.minus(bigint_de_chunks_agg);
                    const delta_block_size = bigint_ex_blocks_agg.minus(bigint_de_blocks_agg);
                    const delta_object_size = bigint_ex_obj_agg.minus(bigint_de_obj_agg);
                    const delta_object_count = ((existing_objects_aggregate[bucket._id] &&
                            existing_objects_aggregate[bucket._id].count) || 0) -
                        ((deleted_objects_aggregate[bucket._id] &&
                            deleted_objects_aggregate[bucket._id].count) || 0);
                    // If we won't always update the checkpoint, on no changes
                    // We will reduce all of the chunks from last checkpoint (which can be a lot)
                    new_storage_stats.chunks_capacity = (new BigInteger(new_storage_stats.chunks_capacity)
                            .plus(delta_chunk_compress_size))
                        .toJSON();
                    new_storage_stats.blocks_size = (new BigInteger(new_storage_stats.blocks_size)
                            .plus(delta_block_size))
                        .toJSON();
                    new_storage_stats.objects_size = (new BigInteger(new_storage_stats.objects_size)
                            .plus(delta_object_size))
                        .toJSON();
                    new_storage_stats.objects_count += delta_object_count;
                    new_storage_stats.objects_hist = build_objects_hist(bucket, existing_objects_aggregate, deleted_objects_aggregate);

                    dbg.log3('Bucket storage stats after deltas:', new_storage_stats);
                    return {
                        _id: bucket._id,
                        storage_stats: new_storage_stats,
                    };
                });

                return system_store.make_changes({
                        update: {
                            buckets: bucket_updates
                        }
                    })
                    .delay(1000)
                    .return(bucket_updates);
            });
        });
}

function check_time_conditions(from_date, till_date, group_to_aggregate, current_time) {
    if (from_date > till_date) {
        return P.reject(new Error(`Skipping current group: ${_.map(group_to_aggregate,
                        bucket => bucket.name)}`));
    }

    if (from_date > current_time || till_date > current_time) {
        console.error(`Timeskew detected: reverting buckets ${_.map(group_to_aggregate,
                        bucket => bucket.name)} to initialized values`);
        return system_store.make_changes({
                update: {
                    buckets: _.map(group_to_aggregate, bucket => ({
                        _id: bucket._id,
                        storage_stats: {
                            chunks_capacity: 0,
                            blocks_size: 0,
                            objects_size: 0,
                            objects_count: 0,
                            objects_hist: [],
                            // Assigning NOOBAA_EPOCH so we will gather all data again till the new time
                            // This means that we will be eventually consistent
                            last_update: config.NOOBAA_EPOCH
                        },
                    }))
                }
            })
            .then(() => {
                throw new Error('check_time_conditions: Reverted successfully');
            });
    }

    return P.resolve();
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
    let bigint_existing_size_bin = new size_utils.BigInteger(existing);
    let bigint_deleted_size_bin = new size_utils.BigInteger(deleted);
    let delta_size_bin = bigint_existing_size_bin
        .minus(bigint_deleted_size_bin);
    let new_bin = (new size_utils.BigInteger(current).plus(delta_size_bin))
        .toJSON();
    return new_bin;
}


// EXPORTS
exports.background_worker = background_worker;
