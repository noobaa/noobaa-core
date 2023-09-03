/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('analyze_resource');

const get_cloud_vendor = require('./analyze_resource_cloud_vendor').get_cloud_vendor;

const connection_basic_details = {
    bucket: process.env.BUCKET,
    endpoint: process.env.ENDPOINT,
    region: process.env.REGION,
    signature_version: process.env.RESOURCE_TYPE === 'aws-s3' ? 'v4' : process.env.S3_SIGNATURE_VERSION,
};

const testing_status = {
    pass: [],
    fail: [],
    skip: [],
};

const resource_name = process.env.RESOURCE_NAME;

async function main() {
    try {
        const resource_type = process.env.RESOURCE_TYPE;
        check_supported_resource_type(resource_type);
        console.info('connection_basic_details', connection_basic_details);
        const cloud_vendor = get_cloud_vendor(resource_type, connection_basic_details);
        await test_resource(cloud_vendor, connection_basic_details.bucket);
    } catch (err) {
        // we use this string as a summary in the file (in the operator repo)
        const prefix_of_tests_result = 'Test Diagnose Resource Failed';
        console.error(`${prefix_of_tests_result} ${resource_name}: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

function check_supported_resource_type(resource_type) {
    const SUPPORTED_TYPES_OF_RESOURCES = ['aws-s3', 's3-compatible', 'ibm-cos', 'google-cloud-storage', 'azure-blob']; //'pv-pool' and 'nsfs' are not cloud vendor and we will not check them
    if (SUPPORTED_TYPES_OF_RESOURCES.includes(resource_type)) {
        console.info('Diagnose Resource Started');
    } else {
        throw new Error(`${resource_type} is not supported`);
    }
}

async function test_resource(cloud_vendor, bucket) {
    check_arguments(cloud_vendor, bucket);
    console.info(`We will have several tests to check the status of the resource and permissions of the bucket ${bucket}`);
    let head_object_executed;
    let head_skip_reason;
    const key_to_head = await list_objects_and_get_one_key(cloud_vendor, bucket);
    if (key_to_head) {
        console.info(`A returned key: ${key_to_head}`);
        await head_object(cloud_vendor, bucket, key_to_head);
        head_object_executed = true;
    } else {
        head_skip_reason = 'head object after list objects was not executed since there was no returned key';
    }
    const key_to_write = `test_resource_${new Date().getTime()}_(can_be_deleted).txt`;
    const is_write_object = await write_object(cloud_vendor, bucket, key_to_write);

    // in case we wrote an object but we didn't have a returned key from the bucket
    // we will try to head the written object
    if (is_write_object && !key_to_head) {
        await head_object(cloud_vendor, bucket, key_to_write);
        head_object_executed = true;
    }
    if (!is_write_object && !key_to_head) {
        head_skip_reason = `head object (after write object) skipped since ${key_to_write} was not written to the bucket`;
    }
    if (!head_object_executed) {
        testing_status.skip.push('head object');
        console.warn(`Test head object in bucket ${bucket} skipped, since ${head_skip_reason}`);
    }

    // in case we wrote an object we want to delete it
    await delete_object_after_write(cloud_vendor, bucket, key_to_write, is_write_object);
    print_test_summary();
}

function check_arguments(cloud_vendor, bucket) {
    const test = 'test_resource';
    if (!cloud_vendor) {
        console.warn(`${test}: connection details of the cloud vendor were not provided.`);
        throw new Error(`Connection details of the cloud vendor were not provided. Please provide connection details`);
    }
    if (!bucket) {
        console.warn(`${test}: bucket was not provided`);
        throw new Error(`Bucket was not provided. Please provide bucket`);
    }
}

async function list_objects_and_get_one_key(cloud_vendor, bucket) {
    const test = 'list objects';
    let key;
    try {
        await cloud_vendor.list_objects(bucket);
        console.info(`Test ${test} in bucket ${bucket} passed `);
        testing_status.pass.push(test);
        key = await cloud_vendor.get_key();
    } catch (err) {
        testing_status.fail.push(test);
        console.error(`Test ${test} in bucket ${bucket} failed, error: `, err);
    }
    return key;
}

async function head_object(cloud_vendor, bucket, key) {
    const test = 'head object';
    try {
        await cloud_vendor.head_object(bucket, key);
        console.info(`Test ${test} in bucket ${bucket} passed `);
        testing_status.pass.push(test);
    } catch (err) {
        testing_status.fail.push(test);
        console.error(`Test ${test} in bucket ${bucket} on key ${key} failed, error: `, err);
    }
}

async function write_object(cloud_vendor, bucket, key) {
    const test = 'write object';
    let is_write_object = false;
    try {
        await cloud_vendor.write_object(bucket, key);
        console.info(`Test ${test} in bucket ${bucket} passed `);
        testing_status.pass.push(test);
        is_write_object = true;
    } catch (err) {
        testing_status.fail.push(test);
        console.error(`Test ${test} in bucket ${bucket} failed, error: `, err);
    }
    return is_write_object;
}

async function delete_object_after_write(cloud_vendor, bucket, key, is_write_object) {
    const test = 'delete object';
    if (is_write_object) {
        await delete_object(cloud_vendor, bucket, key);
    } else {
        testing_status.skip.push(test);
        console.warn(`Test ${test} in bucket ${bucket} skipped, since object ${key} was not written`);
    }
}

async function delete_object(cloud_vendor, bucket, key) {
    const test = 'delete object';
    try {
        await cloud_vendor.delete_object(bucket, key);
        testing_status.pass.push(test);
    } catch (err) {
        testing_status.fail.push(test);
        console.error(`Test ${test} in bucket ${bucket} failed, object ${key} was written and not deleted, error: `, err);
    }
}

function print_test_summary() {
    // we use this string to find the test summary in the file (in the operator repo)
    const prefix_of_tests_result = 'Analyze Resource Tests Result';
    console.info(`${prefix_of_tests_result} ${resource_name}: ${testing_status.pass.length} passed, ${testing_status.fail.length} failed, and ${testing_status.skip.length} skipped.`);
    if (testing_status.pass.length > 0) console.info(`Passed Tests: ${testing_status.pass}`);
    if (testing_status.fail.length > 0) console.info(`Failed Tests: ${testing_status.fail}`);
    if (testing_status.skip.length > 0) console.info(`Skipped Tests: ${testing_status.skip}`);
}

if (require.main === module) {
    main();
}
