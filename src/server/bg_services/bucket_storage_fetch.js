/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const size_utils = require('../../util/size_utils');
const system_store = require('../system_services/system_store').get_instance();

// TODO: This method is based on a single system
function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }
    // First bucket always exists and always will have the earliest update time
    const first_bucket = system_store.data.buckets[0];
    if (!first_bucket) {
        dbg.log0('There are no buckets to fetch');
        return;
    }

    const last_update = (first_bucket.storage_stats && first_bucket.storage_stats.last_update) || 0;
    const from_date = new Date(last_update);
    const till_date = new Date();

    // TODO: This can only happen if the time was adjusted by NTP or manually
    // We initilize the calculations and gather them once again
    // Notice: This is eventually consistent which means that when you upload
    // in the future and roll back the time to the past, you won't see the changes
    // untill you reach the future time.
    // This should be changed and is an open issue
    if (till_date < from_date) {
        console.error('Time has been changed, initilized all bucket storage calculations');
        return P.resolve(system_store.make_changes({
                update: {
                    buckets: _.map(system_store.data.buckets, bucket => ({
                        _id: bucket._id,
                        storage_stats: {
                            chunks_capacity: 0,
                            objects_size: 0,
                            objects_count: 0,
                            // TODO: Assigning Epoch so we will gather all data till the new time
                            last_update: 0
                            // TODO: This is a hack in order to know where we were before the time change
                            // The hack did not work, we updated immediately the correct values, but afterwards
                            // when we've reached the time that they were created at (in the future), we added them again.
                            // This is why we are eventually consistent, and the values will appear in the future, and not immediately.
                            // last_update: -(params.from_date.getTime() + config.BUCKET_FETCH_INTERVAL)
                        },
                    }))
                }
            }))
            .return();
    }

    return P.join(
            MDStore.instance().aggregate_chunks_by_create_dates(from_date, till_date),
            MDStore.instance().aggregate_chunks_by_delete_dates(from_date, till_date),
            MDStore.instance().aggregate_objects_by_create_dates(from_date, till_date),
            MDStore.instance().aggregate_objects_by_delete_dates(from_date, till_date)
        ).spread(function(
            existing_chunks_aggregate,
            deleted_chunks_aggregate,
            existing_objects_aggregate,
            deleted_objects_aggregate) {
            let bucket_updates = _.map(system_store.data.buckets, bucket => {
                let new_storage_stats = {
                    chunks_capacity: (bucket.storage_stats && bucket.storage_stats.chunks_capacity) || 0,
                    objects_size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
                    objects_count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0,
                    last_update: till_date.getTime(),
                };
                dbg.log0('Bucket storage stats before deltas:', new_storage_stats);
                let bigint_ex_chunks_agg = new size_utils.BigInteger((existing_chunks_aggregate[bucket._id] && existing_chunks_aggregate[bucket._id].compress_size) || 0);
                let bigint_de_chunks_agg = new size_utils.BigInteger((deleted_chunks_aggregate[bucket._id] && deleted_chunks_aggregate[bucket._id].compress_size) || 0);
                let bigint_ex_obj_agg = new size_utils.BigInteger((existing_objects_aggregate[bucket._id] && existing_objects_aggregate[bucket._id].size) || 0);
                let bigint_de_obj_agg = new size_utils.BigInteger((deleted_objects_aggregate[bucket._id] && deleted_objects_aggregate[bucket._id].size) || 0);

                let delta_chunk_compress_size = bigint_ex_chunks_agg.minus(bigint_de_chunks_agg);
                let delta_object_size = bigint_ex_obj_agg.minus(bigint_de_obj_agg);
                let delta_object_count = ((existing_objects_aggregate[bucket._id] && existing_objects_aggregate[bucket._id].count) || 0) -
                    ((deleted_objects_aggregate[bucket._id] && deleted_objects_aggregate[bucket._id].count) || 0);
                // If we won't always update the checkpoint, on no changes
                // We will reduce all of the chunks from last checkpoint (which can be a lot)
                new_storage_stats.chunks_capacity = (new size_utils.BigInteger(new_storage_stats.chunks_capacity).plus(delta_chunk_compress_size)).toJSON();
                new_storage_stats.objects_size = (new size_utils.BigInteger(new_storage_stats.objects_size).plus(delta_object_size)).toJSON();
                new_storage_stats.objects_count += delta_object_count;
                new_storage_stats.objects_size_hist = get_objects_size_hist(bucket, existing_objects_aggregate, deleted_objects_aggregate);
                new_storage_stats.objects_count_hist = get_objects_count_hist(bucket, existing_objects_aggregate, deleted_objects_aggregate);

                dbg.log0('Bucket storage stats after deltas:', new_storage_stats);
                return {
                    _id: bucket._id,
                    storage_stats: new_storage_stats,
                };
            });
            return system_store.make_changes({
                update: {
                    buckets: bucket_updates
                }
            });
        })
        .catch(err => {
            dbg.log0('BUCKET STORAGE FETCH:', 'ERROR', err, err.stack);
        })
        .return();
}

function get_hist_array_from_aggregate(agg, key) {
    return [
        (agg && agg[key + '_0mega']) || 0,
        (agg && agg[key + '_5mega']) || 0,
        (agg && agg[key + '_100mega']) || 0,
        (agg && agg[key + '_1gig']) || 0,
        (agg && agg[key + '_100gig']) || 0,
        (agg && agg[key + '_1tb']) || 0,
        (agg && agg[key + '_10tb']) || 0
    ];
}


function get_objects_size_hist(bucket, existing_agg, deleted_agg) {
    let current_objects_size_hist = (bucket.storage_stats && bucket.storage_stats.objects_size_hist) || [0, 0, 0, 0, 0, 0, 0];
    let existing_size_hist = get_hist_array_from_aggregate(existing_agg[bucket._id], 'size');
    let deleted_size_hist = get_hist_array_from_aggregate(deleted_agg[bucket._id], 'size');
    let new_size_hist = [];
    // calculate new size for each bin
    for (var i = 0; i < current_objects_size_hist.length; i++) {
        let bigint_existing_size_bin = new size_utils.BigInteger(existing_size_hist[i]);
        let bigint_deleted_size_bin = new size_utils.BigInteger(deleted_size_hist[i]);
        let delta_size_bin = bigint_existing_size_bin.minus(bigint_deleted_size_bin);
        new_size_hist.push((new size_utils.BigInteger(current_objects_size_hist[i]).plus(delta_size_bin)).toJSON());
    }
    return new_size_hist;
}


function get_objects_count_hist(bucket, existing_agg, deleted_agg) {
    let current_objects_count_hist = (bucket.storage_stats && bucket.storage_stats.objects_count_hist) || [0, 0, 0, 0, 0, 0, 0];
    let existing_count_hist = get_hist_array_from_aggregate(existing_agg[bucket._id], 'count');
    let deleted_count_hist = get_hist_array_from_aggregate(deleted_agg[bucket._id], 'count');
    let new_count_hist = [];
    // calculate new size for each bin
    for (var i = 0; i < current_objects_count_hist.length; i++) {
        let delta_count_bin = existing_count_hist[i] - deleted_count_hist[i];
        new_count_hist.push(current_objects_count_hist[i] + delta_count_bin);
    }
    return new_count_hist;
}


// EXPORTS
exports.background_worker = background_worker;
