/* Copyright (C) 2016 NooBaa */
'use strict';

const assert = require('assert');
const promise_utils = require('../../util/promise_utils');
const config = require('../../../config');
const P = require('../../util/promise');

const test_scenarios = [
    'object cached during read to namespace bucket',
    'object cached during upload to namespace bucket',
    'cache_last_valid_time gets updated after ttl expires',
    'cache_last_valid_time will not be updated after out-of-band upload and before ttl expires',
    'cache_last_valid_time and etag get updated after ttl expires and out-of-band upload',
    'object removed from hub after ttl expires',
    'get operation: object not found',
    'delete operation success',
    'delete non-exist object',
    'delete object while read cached object is ongoing',
    'read cached object while it is being overwritten',
];

async function run_namespace_cache_tests_non_range_read({ type, ns_context }) {
    // file size MUST be larger than the size of cache block size for testing entire reads
    const min_file_size_kb = (config.NAMESPACE_CACHING.DEFAULT_BLOCK_SIZE / 1024) + 1;
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const file_name1 = `${prefix}_${min_file_size_kb * 2}_KB`;
    const file_name2 = `${prefix}_${min_file_size_kb + 1}_KB`;
    const large_file_name = `${prefix}_${min_file_size_kb * 10}_KB`;
    const file_name_delete_case1 = `delete_${prefix}_${min_file_size_kb + 1}_KB`;
    const file_name_delete_case2 = `delete_${prefix}_${min_file_size_kb + 2}_KB`;
    let cache_last_valid_time;
    let time_start = (new Date()).getTime();

    // !!!!!!!! NOTE: The order of the tests matters. Don't change the order.  !!!!!!!!!!!!
    await ns_context.run_test_case('object cached during upload to namespace bucket', type, async () => {
        // Upload a file to namespace cache bucket
        // Expect that etags in both hub and noobaa cache bucket match
        // Expect that cache_last_valid_time is set in object MD
        const file_name = file_name1;
        await ns_context.upload_via_noobaa_endpoint(type, file_name);
        await ns_context.check_via_cloud(type, file_name1);
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: true,
            file_name,
            expect_same: true
        });
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: false,
            file_name,
            expect_same: true
        });
        await ns_context.validate_cache_noobaa_md({
            type,
            file_name,
            validation_params: {
                cache_last_valid_time_range: {
                    start: time_start,
                    end: (new Date()).getTime()
                }
            }
        });
    });

    await ns_context.run_test_case('cache_last_valid_time gets updated after ttl expires', type, async () => {
        // Wait for cache TTL to expire and read the file again
        // Expect cache_last_valid_time to be updated in object MD

        await ns_context.delay();

        const file_name = file_name1;
        time_start = (new Date()).getTime();
        await ns_context.get_via_noobaa_check_md5(type, file_name);
        await ns_context.validate_cache_noobaa_md({
            type,
            file_name,
            validation_params: {
                cache_last_valid_time_range: {
                    start: time_start,
                    end: (new Date()).getTime()
                }
            }
        });
    });

    await ns_context.run_test_case('cache_last_valid_time will not be updated after out-of-band upload and before ttl expires', type, async () => {
        // Upload the file with different content to hub before cache TTL expires
        // Expect the cached file with different etag to be returned
        // Expect cache_last_valid_time to stay the same
        const file_name = file_name1;
        const md = await ns_context.validate_cache_noobaa_md({
            type,
            file_name,
            validation_params: {},
        });
        cache_last_valid_time = md.cache_last_valid_time;
        await ns_context.upload_directly_to_cloud(type, file_name);
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: true,
            file_name,
            expect_same: false
        });
        await ns_context.validate_cache_noobaa_md({
            type,
            file_name,
            validation_params: {
                cache_last_valid_time_range: {
                    start: cache_last_valid_time - 1,
                    end: cache_last_valid_time + 1
                }
            }
        });
    });

    await ns_context.run_test_case('cache_last_valid_time and etag get updated after ttl expires and out-of-band upload', type, async () => {
        // Wait for cache TTL to expire
        // Expect that etags in both hub and noobaa cache bucket match
        // Expect that cache_last_valid_time is updated in object MD

        await ns_context.delay();

        const file_name = file_name1;
        time_start = (new Date()).getTime();
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: false,
            file_name,
            expect_same: true
        });
        await promise_utils.wait_until(async () => {
            try {
                await ns_context.validate_cache_noobaa_md({
                    type,
                    file_name,
                    validation_params: {
                        cache_last_valid_time_range: {
                            start: time_start,
                            end: (new Date()).getTime()
                        }
                    }
                });
                return true;
            } catch (err) {
                if (err.rpc_code === 'NO_SUCH_OBJECT') return false;
                throw err;
            }
        }, 10000);
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: true,
            file_name,
            expect_same: true
        });
    });

    await ns_context.run_test_case('object cached during read to namespace bucket', type, async () => {
        // Upload a file to hub bucket and read it from namespace bucket
        // Expect that etags in both hub and noobaa cache bucket match
        // Expect that cache_last_valid_time is set in object MD
        const file_name = file_name2;
        await ns_context.upload_directly_to_cloud(type, file_name);
        time_start = (new Date()).getTime();
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: false,
            file_name,
            expect_same: true
        });
        await promise_utils.wait_until(async () => {
            try {
                await ns_context.validate_cache_noobaa_md({
                    type,
                    file_name,
                    validation_params: {
                        cache_last_valid_time_range: {
                            start: time_start,
                            end: (new Date()).getTime()
                        }
                    }
                });
                return true;
            } catch (err) {
                if (err.rpc_code === 'NO_SUCH_OBJECT') return false;
                throw err;
            }
        }, 10000);
    });

    await ns_context.run_test_case('object removed from hub after ttl expires', type, async () => {
        // Upload a file to cache bucket and delete it from hub bucket
        // Expect 404 to be returned for read from cache bucket after TTL expires
        const file_name = file_name_delete_case1;
        await ns_context.upload_via_noobaa_endpoint(type, file_name);
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: true,
            file_name,
            expect_same: true
        });

        await ns_context.delay();

        await ns_context.delete_from_cloud(type, file_name);
        await ns_context.get_via_noobaa_expect_not_found(type, file_name);
    });

    await ns_context.run_test_case('delete operation success', type, async () => {
        const file_name = file_name_delete_case2;
        await ns_context.upload_via_noobaa_endpoint(type, file_name);
        await ns_context.validate_md5_between_hub_and_cache({
            type,
            force_cache_read: true,
            file_name,
            expect_same: true
        });
        await ns_context.delete_from_noobaa(type, file_name);
        await ns_context.get_via_noobaa_expect_not_found(type, file_name);
        await ns_context.get_via_cloud_expect_not_found(type, file_name);
    });

    await ns_context.run_test_case('get operation: object not found', type, async () => {
        const file_name = 'file_not_exist_123';
        await ns_context.get_via_noobaa_expect_not_found(type, file_name);
    });

    await ns_context.run_test_case('delete non-exist object', type, async () => {
        const file_name = 'file_not_exist_123';
        await ns_context.delete_from_noobaa(type, file_name);
    });

    await ns_context.run_test_case('delete object while read cached object is ongoing', type, async () => {
        // Upload a large file to namespace cache bucket
        const file_name = large_file_name;
        const upload_md = await ns_context.upload_via_noobaa_endpoint(type, file_name);
        const upload_md5 = upload_md.md5;

        const read_prom = ns_context.get_via_noobaa(type, file_name)
            .then(ret => {
                assert(ret.md5 === upload_md5);
                return ret;
            });

        const delete_prom = P.delay(50).then(() => ns_context.delete_from_noobaa(type, file_name));

        return Promise.all([read_prom, delete_prom])
            .then(ret => {
                console.log('success in deleting cached object while read is onging', ret);
            });
    });

    await ns_context.run_test_case('read cached object while it is being overwritten', type, async () => {
        // Upload a large file to namespace cache bucket
        const file_name = large_file_name;
        const first_upload_md = await ns_context.upload_via_noobaa_endpoint(type, file_name);
        const first_upload_md5 = first_upload_md.md5;

        const read_prom = ns_context.get_via_noobaa(type, file_name)
            .then(ret => {
                assert(ret.md5 === first_upload_md5);
                return ret;
            });

        const new_upload_prom = P.delay(50).then(() => ns_context.upload_via_noobaa_endpoint(type, file_name));

        return Promise.all([read_prom, new_upload_prom])
            .then(ret => {
                console.log('success in reading cached object while overwrite is onging');
                assert(first_upload_md5 !== ret[1].md5);
            });
    });
}

module.exports.test_scenarios = test_scenarios;
module.exports.run = run_namespace_cache_tests_non_range_read;
