/* Copyright (C) 2025 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const config = require('../../config');
const nb_native = require('./nb_native');

/**
 * get_latest_nc_lifecycle_run_status returns the latest lifecycle run status
 * latest run can be found by maxing the lifecycle log entry names, log entry name is the lifecycle_run_{timestamp}.json of the run
 * @param {Object} config_fs
 * @param {{silent_if_missing: boolean}} options
 * @returns {Promise<object | undefined >}
 */
async function get_latest_nc_lifecycle_run_status(config_fs, options) {
    const { silent_if_missing = false } = options;
    try {
        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, config.NC_LIFECYCLE_LOGS_DIR);
        const latest_lifecycle_run = _.maxBy(lifecycle_log_entries, entry => entry.name);
        const latest_lifecycle_run_status_path = path.join(config.NC_LIFECYCLE_LOGS_DIR, latest_lifecycle_run.name);
        const latest_lifecycle_run_status = await config_fs.get_config_data(latest_lifecycle_run_status_path, options);
        return latest_lifecycle_run_status;
    } catch (err) {
        if (err.code === 'ENOENT' && silent_if_missing) {
            return;
        }
        throw err;
    }
}

/**
 * get_lifecycle_object_info_for_filter returns an object that contains properties needed for filter check
 * based on list_objects/stat result 
 * @param {{key: String, create_time: Number, size: Number, tagging: Object}} entry list object entry
 * @returns {{key: String, age: Number, size: Number, tags: Object}}
 */
function get_lifecycle_object_info_for_filter(entry) {
    return {
        key: entry.key,
        age: get_file_age_days(entry.create_time),
        size: entry.size,
        tags: entry.tagging,
    };
}


/**
 * get_file_age_days gets file time since last modified in days
 * @param {Number} mtime
 * @returns {Number} days since object was last modified
 */
function get_file_age_days(mtime) {
    return Math.floor((Date.now() - mtime) / 24 / 60 / 60 / 1000);
}

/**
 * file_matches_filter used for checking the filter before deletion
 * @param {{obj_info: { key: String, create_time: Number, size: Number, tagging: Object}, filter_func?: Function}} params 
 * @returns {Boolean}
 */
function file_matches_filter({obj_info, filter_func = undefined}) {
    if (filter_func) {
        const object_info_for_filter = get_lifecycle_object_info_for_filter(obj_info);
        if (!filter_func(object_info_for_filter)) {
            return false;
        }
    }
    return true;
}

/**
 * get_lifecycle_rule_for_object determines the most specific matching lifecycle rule for the given object metadata
 *
 * @param {Array<Object>} rules
 * @param {Object} object_info
 * @returns {Object|undefined}
 */
function get_lifecycle_rule_for_object(rules, object_info) {
    if (!object_info?.key || !Array.isArray(rules) || rules.length < 1) return;

    let matched_rule;
    let curr_priority = {
        prefix_len: -1,
        tag_count: -1,
        size_span: Infinity,
    };

    for (const rule of rules) {
        if (rule?.status !== 'Enabled') continue;

        const filter_func = build_lifecycle_filter(rule);
        if (!filter_func(object_info)) continue;

        const new_priority = get_rule_priority(rule.filter);

        if (compare_rule_priority(curr_priority, new_priority)) {
            matched_rule = rule;
            curr_priority = new_priority;
        }
    }
    return matched_rule;
}

/**
 * build_expiration_header converts an expiration rule (either with `date` or `days`)
 * into an s3 style `x-amz-expiration` header value
 *
 * @param {Object} rule
 * @param {Object} create_time
 * @returns {string|undefined}
 *
 * Example output:
 *   expiry-date="Thu, 10 Apr 2025 00:00:00 GMT", rule-id="rule_id"
 */
function build_expiration_header(rule, create_time) {
    const expiration = rule.expiration;
    const rule_id = rule.id;

    if (!expiration || (!expiration.date && !expiration.days)) return undefined;

    const expiration_date = expiration.date ?
        new Date(expiration.date) :
        new Date(create_time + expiration.days * 24 * 60 * 60 * 1000);

    expiration_date.setUTCHours(0, 0, 0, 0); // adjust expiration to midnight UTC

    return `expiry-date="${expiration_date.toUTCString()}", rule-id="${rule_id}"`;
}

//////////////////
// FILTERS HELPERS //
//////////////////

/**
 * Creates a filter function to determine if an object matches specified lifecycle criteria.
 *
 * The returned function excludes temporary files, folder marker objects, and versioned objects before applying additional filter conditions such as prefix, minimum age, tag set, and object size constraints.
 *
 * @param {filter_params} params - Lifecycle filter and expiration criteria.
 * @returns {(object_info: Object) => boolean} A function that returns true if the object matches all lifecycle filter conditions.
 */
function build_lifecycle_filter(params) {
    /**
     * @param {Object} object_info
     */
    return function(object_info) {
        // fail if object is a temp file/part or a folder object or a versioned object
        if (object_info.key.startsWith(config.NSFS_TEMP_DIR_NAME)) return false;
        if (object_info.key.includes(config.NSFS_FOLDER_OBJECT_NAME)) return false;
        if (object_info.key.includes('.versions/')) return false;

        if (params.filter?.prefix && !object_info.key.startsWith(params.filter.prefix)) return false;
        if (params.expiration && object_info.age < params.expiration) return false;
        if (params.filter?.tags && !file_contain_tags(object_info, params.filter.tags)) return false;
        if (params.filter?.object_size_greater_than && object_info.size < params.filter.object_size_greater_than) return false;
        if (params.filter?.object_size_less_than && object_info.size > params.filter.object_size_less_than) return false;
        return true;
    };
}

/**
 * get_rule_priority calculates the priority of a lifecycle rule's filter
 *
 * @param {Object} filter
 * @returns {Object} priority object
 */
function get_rule_priority(filter) {
    return {
        prefix_len: (filter?.prefix || '').length,
        tag_count: Array.isArray(filter?.tags) ? filter.tags.length : 0,
        size_span: (filter?.object_size_less_than ?? Infinity) - (filter?.object_size_greater_than ?? 0)
    };
}

/**
 * compare_rule_priority determines if a new rule has higher priority
 *
 * priority is based on:
 *  - longest matching prefix
 *  - most matching tags
 *  - narrowest object size range
 *
 * @param {Object} curr_priority
 * @param {Object} new_priority
 * @returns {boolean}
 */
function compare_rule_priority(curr_priority, new_priority) {
    // compare prefix length
    if (new_priority.prefix_len > curr_priority.prefix_len) return true;

    if (new_priority.prefix_len === curr_priority.prefix_len) {
        // compare tag count (if prefixes are equal)
        if (new_priority.tag_count > curr_priority.tag_count) return true;

        if (new_priority.tag_count === curr_priority.tag_count) {
            // compare size span (if prefixes and tags are equal)
            if (new_priority.size_span < curr_priority.size_span) return true;
        }
    }

    return false;
}

//////////////////
// TAGS HELPERS //
//////////////////

/**
 * checks if tag query_tag is in the list tag_set
 * @param {Object} query_tag
 * @param {Array<Object>} tag_set
 */
function list_contain_tag(query_tag, tag_set) {
    for (const t of tag_set) {
        if (t.key === query_tag.key && t.value === query_tag.value) return true;
    }
    return false;
}

/**
 * checks if object has all the tags in filter_tags
 * @param {Object} object_info
 * @param {Array<Object>} filter_tags
 * @returns
 */
function file_contain_tags(object_info, filter_tags) {
    const object_tags = object_info.tags || object_info.tagging;
    if (!object_tags) return false;
    for (const tag of filter_tags) {
        if (!list_contain_tag(tag, object_tags)) {
            return false;
        }
    }
    return true;
}

exports.get_latest_nc_lifecycle_run_status = get_latest_nc_lifecycle_run_status;
exports.file_matches_filter = file_matches_filter;
exports.get_lifecycle_object_info_for_filter = get_lifecycle_object_info_for_filter;
exports.get_file_age_days = get_file_age_days;
exports.get_lifecycle_rule_for_object = get_lifecycle_rule_for_object;
exports.build_expiration_header = build_expiration_header;
exports.build_lifecycle_filter = build_lifecycle_filter;
