/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');

/**
 * get_bin_path returns the full path to the binary file.
 * @param {String} bin_dir 
 * @param {String} bin_name 
 * @returns {String}
 */
function get_bin_path(bin_dir, bin_name) {
    return path.join(bin_dir, bin_name);
}

// EXPORTS
exports.get_bin_path = get_bin_path;
