/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');
const config = require('../../../config.js');

const test_scenarios = [];
const test_funcs = [];

function register_test_scenarios(fn) {
    assert(!test_scenarios.includes(fn.desc));
    test_scenarios.push(fn.desc);
    test_funcs.push(fn);
}

async function test_case_range_read_initial_read_size_not_across_blocks({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const file_name = `${prefix}_${block_size_kb * 5}_KB`;
    let time_start = (new Date()).getTime();

    // Expect block3 will be cached
    // blocks     :  |       b0        |       b1         |       b2      |  b3(to be cached) |   .....
    // read range :                                                         <-->
    let range_size = 100;
    let start = (block_size * 3) + 100;
    let end = start + range_size - 1;

    await ns_context.upload_directly_to_cloud(type, file_name);
    let cloud_obj_md = await ns_context.get_via_cloud(type, file_name);
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
    let time_end = (new Date()).getTime();

    // Expect block1 will be cached, so we will have block1 and block3 cached
    // blocks     :  |       b0        | b1(to be cached) |       b2      |    b3(cached)     |   .....
    // read range :                      <-->
    range_size = 200;
    start = block_size + 100;
    end = start + range_size - 1;
    // Read the same range twice.
    for (let i = 0; i < 2; i++) {
        await ns_context.validate_range_read({
            type, file_name, cloud_obj_md,
            start, end,
            expect_read_size: range_size,
            upload_size: block_size * 2,
            expect_num_parts: 2,
            cache_last_valid_time_range: {
                start: time_start,
                end: time_end
            }
        });
    }

    // Expect block0 and block2 to be cached
    // blocks     :  | b0(to be cached)|    b1(cached)    | b2(to be cached) |    b3(cached)     |   .....
    // read range :    <------------------------------------>
    range_size = block_size * 2;
    start = 100;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 4,
        expect_upload_size: block_size * 4,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect range read to come from cache
    // blocks     :  |    b0(cached)    |    b1(cached)    |    b2(cached)    |    b3(cached)     |   .....
    // read range :    <-------------------------------------------------------->
    range_size = block_size * 3;
    start = 100;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 4,
        expect_upload_size: block_size * 4,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect aligned range read to come from cache
    // blocks     :  |    b0(cached)    |    b1(cached)    |    b2(cached)    |    b3(cached)     |   .....
    // read range :                     <------------------>
    range_size = block_size;
    start = block_size;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 4,
        expect_upload_size: block_size * 4,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect all old cached ranges are deleted after file is changed in hub
    // blocks     :  |       b0         |  b1(to be cached) | b2(to be cached) |  b3(to be cached) |   .....
    // read range :                       <-------------------------------------->
    await ns_context.upload_directly_to_cloud(type, file_name);
    cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

    await ns_context.delay();

    range_size = (block_size * 2) + 100;
    start = block_size + 100;
    end = start + range_size - 1;
    time_start = (new Date()).getTime();
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 1,
        expect_upload_size: block_size * 3,
        cache_last_valid_time_range: {
            start: time_start,
            end: null
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    // blocks     :  |       b0         |     b1(cached)    |    b2(cached)    |     b3(cached)    |   .....
    // read range :                       <-------------------------------------->
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_initial_read_size_not_across_blocks.desc = 'range read: initial read size is < block_size and not across block boundary';
register_test_scenarios(test_case_range_read_initial_read_size_not_across_blocks);

async function test_case_range_read_range_variations({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const size_block_count = 4;
    const file_name = `${prefix}_${block_size_kb * size_block_count}_KB`;
    let time_start = (new Date()).getTime();

    // Expect block3 will be cached
    // blocks     :  |       b0        | b1(to be cached) | b2(to be cached) |         b3       |
    // read range :                                      <----------------->
    let range_size = block_size;
    let start = (block_size * 2) - 100;
    let end = start + range_size - 1;

    await ns_context.upload_directly_to_cloud(type, file_name);
    const cloud_obj_md = await ns_context.get_via_cloud(type, file_name);
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size * 2,
        expect_num_parts: 1,
        cache_last_valid_time_range: {
            start: time_start,
        }
    });

    // Expect read range to come from cached block
    // blocks     :  |       b0        |    b1(cached)    +    b2(cached)    |         b3       |
    // read range :                                         <->
    range_size = 100;
    start = (block_size * 2) + 100;
    end = start + range_size - 1;
    const time_end = (new Date()).getTime();
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size * 2,
        expect_num_parts: 1,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect read range to come from cached block
    // blocks     :  |       b0        |    b1(cached)    +    b2(cached)    |         b3       |
    // read range :                    <------------------------------------>
    range_size = block_size * 2;
    start = block_size;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size * 2,
        expect_num_parts: 1,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect block0 and block2 to be cached
    // blocks     :  | b0(to be cached) |    b1(cached)    +    b2(cached)    |         b3       |
    // read range :  <-------------------->
    range_size = block_size + 100;
    start = 0;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 2,
        expect_upload_size: block_size * 3,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Expect range read to come from cache
    // blocks     :  |    b0(cached)    |    b1(cached)    +    b2(cached)    |  b3(to be cached)  |
    // read range :                                                         <------------------------>
    const d = 100;
    range_size = block_size + d;
    start = ((size_block_count - 1) * block_size) - d;
    // end is over the end of file
    end = start + range_size + d;
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 3,
        expect_upload_size: block_size * size_block_count,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    // blocks     :  |    b0(cached)    |     b1(cached)    +    b2(cached)   |     b3(cached)     |
    // read range :                                                         <------------------------>
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_range_variations.desc = 'range read: range variations - range across block boundary and others';
register_test_scenarios(test_case_range_read_range_variations);

async function test_case_range_read_from_entire_object_to_partial({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const file_name = `${prefix}_${block_size_kb * 3}_KB`;

    // Entire object will be cached
    await ns_context.upload_via_noobaa_endpoint(type, file_name);
    await ns_context.check_via_cloud(type, file_name);
    await ns_context.validate_md5_between_hub_and_cache({
        type,
        force_cache_read: true,
        file_name,
        expect_same: true
    });

    await ns_context.delay();

    // Upload new content to hub
    await ns_context.upload_directly_to_cloud(type, file_name);
    const time_start = (new Date()).getTime();
    const cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

    // Expect block1 of new content will be cached
    // blocks     :  |       b0        | b1(to be cached) |        b2       |
    // read range :                      <-->
    let range_size = 100;
    let start = block_size + 100;
    let end = start + range_size - 1;
    // Read the same range twice.
    for (let i = 0; i < 2; i++) {
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
    }

    // Expect the read to come from cached block1
    // blocks     :  |       b0        |     b1(cached)    |        b2       |
    // read range :                      <---->
    range_size = 200;
    end = start + range_size - 1;
    const time_end = (new Date()).getTime();
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 1,
        expect_upload_size: block_size,
        cache_last_valid_time_range: {
            start: time_start,
            end: time_end
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    // blocks     :  |       b0        |     b1(cached)    |        b2       |
    // read range :                      <---->
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_from_entire_object_to_partial.desc = 'range read: from entire object to partial object';
register_test_scenarios(test_case_range_read_from_entire_object_to_partial);

async function test_case_range_read_from_partial_to_entire_object({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const file_name = `${prefix}_${block_size_kb * 3}_KB`;

    // Expect block1 to be cached
    // blocks     :  |       b0        |  b1(to be cached)  |      b2          |
    // read range :                      <-->
    let range_size = 100;
    let start = block_size + 100;
    let end = start + range_size - 1;
    const time_start = (new Date()).getTime();
    await ns_context.upload_directly_to_cloud(type, file_name);
    let cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

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

    // Expect block1 to be cached
    // blocks     :  |       b0        |   b1(cached)      |  b2(to be cached)  |
    // read range :                                           <-->
    start = (block_size * 2) + 100;
    end = start + range_size - 1;
    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size,
        expect_num_parts: 2,
        cache_last_valid_time_range: {
            start: time_start,
        }
    });

    // Read entire object
    // Expect entire object to be cached
    // time_start = (new Date()).getTime();
    await ns_context.validate_md5_between_hub_and_cache({
        type,
        force_cache_read: false,
        file_name,
        expect_same: true
    });
    await ns_context.validate_md5_between_hub_and_cache({
        type,
        force_cache_read: true,
        file_name,
        expect_same: true
    });

    // Expect block1 to be cached
    // blocks     :  |   b0(cached)    |   b1(cached)      |    b2(cached)      |
    // read range :                                           <-->
    // Read the range again
    // Expect the range to be returned from cached entire object
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        expect_num_parts: 3,
        cache_last_valid_time_range: {
            start: time_start,
            end: (new Date()).getTime()
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_from_partial_to_entire_object.desc = 'range read: from partial object to entire object';
register_test_scenarios(test_case_range_read_from_partial_to_entire_object);

async function test_case_range_read_small_file({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size_kb } = ns_context;
    const small_file_size = block_size_kb / 2;
    const file_name = `${prefix}_${small_file_size}_KB`;

    // Expect entire file to be cached
    // blocks     :  |       b0 |......|
    // read range :    <-->
    let range_size = 100;
    let start = config.INLINE_MAX_SIZE;
    let end = start + range_size - 1;
    let time_start = (new Date()).getTime();
    await ns_context.upload_directly_to_cloud(type, file_name);
    const cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

    await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        cache_last_valid_time_range: {
            start: time_start,
        }
    });

    // Read entire file
    await ns_context.validate_md5_between_hub_and_cache({
        type,
        force_cache_read: true,
        file_name,
        expect_same: true
    });

    // Perform another range read
    start = config.INLINE_MAX_SIZE + 50;
    range_size = 200;
    end = start + range_size - 1;
    // Expect the range to be returned from cached entire object
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        cache_last_valid_time_range: {
            start: time_start,
            end: (new Date()).getTime()
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_small_file.desc = 'range read: small file is cached entirely';
register_test_scenarios(test_case_range_read_small_file);

async function test_case_range_read_if_match_etag_failure({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const file_name = `${prefix}_${block_size_kb * 3}_KB`;

    // Expect block1 to be cached
    // blocks     :  |       b0        |  b1(to be cached)  |       b2        |
    // read range :                      <-->
    let range_size = 100;
    let start = block_size + 100;
    let end = start + range_size - 1;
    let time_start = (new Date()).getTime();
    await ns_context.upload_directly_to_cloud(type, file_name);
    let cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

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

    // Upload object with new content to hub
    await ns_context.upload_directly_to_cloud(type, file_name);
    cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

    // Expect block1 to be cached
    // blocks     :  |       b0        |       b1       |  b2(to be cached) |
    // read range :                                        <-->
    start = (block_size * 2) + 100;
    end = start + range_size - 1;
    time_start = (new Date()).getTime();
    const { noobaa_md } = await ns_context.validate_range_read({
        type, file_name, cloud_obj_md,
        start, end,
        expect_read_size: range_size,
        upload_size: block_size,
        expect_num_parts: 1,
        cache_last_valid_time_range: {
            start: time_start,
        }
    });

    // Delete file from hub before TTL expires. Cache shall return the old cached range
    console.log(`double check cached range is returned after ${file_name} is deleted from hub bucket and before TTL expires`);
    await ns_context.delete_from_cloud(type, file_name);
    await ns_context.get_via_cloud_expect_not_found(type, file_name);
    const noobaa_md_again = await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end);
    if (!_.isEqual(noobaa_md, noobaa_md_again)) {
        throw new Error(`Unexpected range read results: expected ${JSON.stringify(noobaa_md)} but got ${JSON.stringify(noobaa_md_again)}`);
    }
}
test_case_range_read_if_match_etag_failure.desc = 'range read: if-match etag failure during range read on hub';
register_test_scenarios(test_case_range_read_if_match_etag_failure);

async function test_case_range_read_precondition_set_in_s3_request({ type, ns_context }) {

    // Make file big enough for holding multiple blocks
    const prefix = `file_${(Math.floor(Date.now() / 1000))}_${type}`;
    const { block_size, block_size_kb } = ns_context;
    const file_name = `${prefix}_${block_size_kb * 2}_KB`;

    const range_size = 100;
    const start = block_size + 100;
    const end = start + range_size - 1;
    await ns_context.upload_directly_to_cloud(type, file_name);
    const cloud_obj_md = await ns_context.get_via_cloud(type, file_name);

    // Expect the request is proxied to hub.
    try {
        await ns_context.get_range_md5_size_via_noobaa(type, file_name, start, end, { IfMatch: 'etag not matched' });
        assert(false);
    } catch (err) {
        assert(err.code === 'PreconditionFailed');
    }

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
}
test_case_range_read_precondition_set_in_s3_request.desc = 'range read: s3 request has precondtion set';
register_test_scenarios(test_case_range_read_precondition_set_in_s3_request);


async function run_namespace_cache_tests_range_read({ type, ns_context }) {
    for (const test_fn of test_funcs) {
        await ns_context.run_test_case(test_fn.desc, type,
            async () => {
                await test_fn({ type, ns_context });
            }
        );
    }
}

module.exports.test_scenarios = test_scenarios;
module.exports.run = run_namespace_cache_tests_range_read;
