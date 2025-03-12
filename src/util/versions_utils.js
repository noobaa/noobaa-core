/* Copyright (C) 2025 NooBaa */
"use strict";

/**
 * @param {string} ver
 */
function parse_ver(ver) {
    const stripped_ver = ver.split('-')[0];
    return stripped_ver.split('.').map(i => Number.parseInt(i, 10));
}

/**
 * version_compare compares 2 versions. returns positive if ver1 is larger, negative if ver2, 0 if equal
 * @param {string} ver1
 * @param {string} ver2
 */
function version_compare(ver1, ver2) {
    const ver1_arr = parse_ver(ver1);
    const ver2_arr = parse_ver(ver2);
    const max_length = Math.max(ver1_arr.length, ver2_arr.length);
    for (let i = 0; i < max_length; ++i) {
        const comp1 = ver1_arr[i] || 0;
        const comp2 = ver2_arr[i] || 0;
        const diff = comp1 - comp2;
        // if version component is not the same, return the difference
        if (diff) return diff;
    }
    return 0;
}

/**
 * is_valid_semantic_version checks that the version string is a valid sematic version
 *   1. strips the additional "-<something>" that might be added, for example: -alpha, -beta etc
 *   2. checks that the version has the sematic version is from the structure of version: major.minor.patch
 * @param {string} version
 * @returns {boolean}
 */
function is_valid_semantic_version(version) {
    const stripped_ver = version.split('-')[0];
    // sematic version is from the structure of version: major.minor.patch
    const semantic_version_regex = /^\d+\.\d+.\.\d+$/;
    return semantic_version_regex.test(stripped_ver);
}

exports.version_compare = version_compare;
exports.is_valid_semantic_version = is_valid_semantic_version;

