/* Copyright (C) 2016 NooBaa */
'use strict';

const assert = require('assert');
const config = require('../../../config.js');

const test_scenarios = [];
const test_funcs = [];

function register_test_scenarios(fn) {
    assert(!test_scenarios.includes(fn.desc));
    test_scenarios.push(fn.desc);
    test_funcs.push(fn);
}

async function test_case_large_file_not_cached({ type, ns_context }) {

    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const max_cached_file_size = config.NAMESPACE_CACHING.DEFAULT_MAX_CACHE_OBJECT_SIZE;
    const max_cached_file_size_kb = max_cached_file_size / 1024;
    // Make file size 2 blocks bigger than the max cached file size
    const file_name = `${prefix}_${max_cached_file_size_kb + (block_size_kb * 2)}_KB`;

    // Upload large file and expect it not cached
    await ns_context.upload_via_noobaa_endpoint(type, file_name);
    const cloud_obj_md = await ns_context.get_size_etag_via_cloud(type, file_name);
    await ns_context.expect_not_found_in_cache(type, file_name);

    // Read large file and expect it not cached
    await ns_context.get_via_noobaa(type, file_name);
    await ns_context.expect_not_found_in_cache(type, file_name);

    // Read range is larger than max cached object size
    // No part gets cached
    let range_size = max_cached_file_size + 200;
    let start = 100;
    let end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
    });

    // Read small range and expect one block gets cached
    range_size = 100;
    start = (block_size * 2) + 100;
    end = start + range_size - 1;
    const time_start = (new Date()).getTime();
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size,
        expect_num_parts: 1,
        cache_last_valid_time_range: {
            start: time_start,
        }
    });

    // Upload new large file and expect it not cached after normal read and ttl expires
    await ns_context.upload_via_noobaa_endpoint(type, file_name);
    await ns_context.get_size_etag_via_cloud(type, file_name);

    await ns_context.delay();

    await ns_context.expect_not_found_in_cache(type, file_name);
}
test_case_large_file_not_cached.desc = 'large file not cached in upload, normal and range read';
register_test_scenarios(test_case_large_file_not_cached);

async function run_namespace_cache_large_file_tests({ type, ns_context }) {
    for (const test_fn of test_funcs) {
        await ns_context.run_test_case(test_fn.desc, type,
            async () => {
                await test_fn({ type, ns_context });
            }
        );
    }
}

module.exports.test_scenarios = test_scenarios;
module.exports.run = run_namespace_cache_large_file_tests;