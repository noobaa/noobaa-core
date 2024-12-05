/* Copyright (C) 2020 NooBaa */
'use strict';

class KeyMarkerFS {
    constructor({ marker, marker_pos, pre_dir, pre_dir_pos }, is_unsorted = false) {
        this.marker = marker;
        this.marker_pos = marker_pos.toString();
        this.pre_dir = pre_dir;
        this.pre_dir_pos = pre_dir_pos;
        this.key_marker_value = marker;
        this.current_dir = '';
        this.is_unsorted = is_unsorted;
        this.last_pre_dir = '';
        this.last_pre_dir_position = '';
        if (is_unsorted) {
            this.current_dir = pre_dir.length > 0 && marker.includes('/') ?
                            marker.substring(0, marker.lastIndexOf('/') + 1) : '';
        }
    }

    async update_key_marker(marker, marker_pos) {
        this.marker = marker;
        this.marker_pos = marker_pos;
        this.key_marker_value = marker;
    }

    async get_previour_dir_length() {
        return this.pre_dir.length;
    }

    async get_previour_dir_info() {
        return {
            pre_dir_path: this.pre_dir.pop(),
            pre_dir_position: this.pre_dir_pos.pop(),
        };
    }

    async add_previour_dir(pre_dir, pre_dir_pos) {
        this.pre_dir.push(pre_dir);
        this.pre_dir_pos.push(pre_dir_pos.toString());
    }

    async update_last_previour_dir(last_pre_dir, last_pre_dir_position) {
        this.last_pre_dir = last_pre_dir;
        this.last_pre_dir_position = last_pre_dir_position;
    }
}

// EXPORTS
module.exports = KeyMarkerFS;
