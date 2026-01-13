/* Copyright (C) 2023 NooBaa */
'use strict';

// Predefined op_names
const op_names = [
    `upload_object`,
    `delete_object`,
    `create_bucket`,
    `list_buckets`,
    `delete_bucket`,
    `list_objects`,
    `head_object`,
    `read_object`,
    `initiate_multipart`,
    `upload_part`,
    `complete_object_upload`,
];

// Predefined iam_op_names
const iam_op_names = [
    `create_user`,
    `get_user`,
    `update_user`,
    `delete_user`,
    `list_users`,
    `create_access_key`,
    `get_access_key_last_used`,
    `update_access_key`,
    `delete_access_key`,
    `list_access_keys`,
];

function update_nsfs_stats(op_name, stats, new_data) {
    //In the event of all of the same ops are failing (count = error_count) we will not masseur the op times
    // As this is intended as a timing masseur and not a counter.
    if (stats[op_name]) {
        const count = stats[op_name].count + new_data.count;
        const error_count = stats[op_name].error_count + new_data.error_count;
        const old_sum_time = stats[op_name].avg_time_milisec * stats[op_name].count;
        //Min time and Max time are not being counted in the endpoint stat collector if it was error
        const min_time_milisec = Math.min(stats[op_name].min_time_milisec, new_data.min_time);
        const max_time_milisec = Math.max(stats[op_name].max_time_milisec, new_data.max_time);
        // At this point, as we populate only when there is at least one successful op, there must be old_sum_time
        const avg_time_milisec = Math.floor((old_sum_time + new_data.sum_time) / (count - error_count));
        stats[op_name] = {
            min_time_milisec,
            max_time_milisec,
            avg_time_milisec,
            count,
            error_count,
        };
        // When it is the first time we populate the stats with op_name we do it
        // only if there are more successful ops than errors.
    } else if (new_data.count > new_data.error_count) {
        stats[op_name] = {
            min_time_milisec: new_data.min_time,
            max_time_milisec: new_data.max_time,
            avg_time_milisec: Math.floor(new_data.sum_time / new_data.count),
            count: new_data.count,
            error_count: new_data.error_count,
        };
    }
}

exports.op_names = op_names;
exports.iam_op_names = iam_op_names;
exports.update_nsfs_stats = update_nsfs_stats;
