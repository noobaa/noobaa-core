/* Copyright (C) 2020 NooBaa */
'use strict';


class ListObjectFS {
    constructor({fs_context, list_versions, keymarker, prefix_dir_key, is_truncated, delimiter, prefix,
        version_id_marker, list_type, results, limit, skip_list, key_marker}) {
        this.fs_context = fs_context;
        this.keymarker = keymarker;
        this.prefix_dir_key = prefix_dir_key;
        this.is_truncated = is_truncated;
        this.delimiter = delimiter;
        this.prefix = prefix;
        this.version_id_marker = version_id_marker;
        this.list_type = list_type;
        this.results = results;
        this.limit = limit;
        this.skip_list = skip_list;
        this.prefix_ent = '';
        this.marker_dir = '';
        this.param_key_marker = key_marker;
        this.list_versions = list_versions;
    }

    async update_process_dir_properties(prefix_ent, marker_curr, dir_path) {
        this.prefix_ent = prefix_ent;
        this.dir_path = dir_path;
    }

    async update_is_truncated(is_truncated) {
        this.is_truncated = is_truncated;
    }

    async get_is_truncated() {
        return this.is_truncated;
    }

    async update_keymarker(keymarker) {
        this.keymarker = keymarker;
    }

    async get_keymarker() {
        return this.keymarker;
    }
}

// EXPORTS
module.exports = ListObjectFS;
