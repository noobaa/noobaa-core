/* Copyright (C) 2016 NooBaa */
"use strict";

/**
 * This script is used as a part of the CI/CD process to run all Ceph S3 tests.
 * It uses the file setup_ceph_s3_config as prior configuration.
 * In the past this script was a part of the CI/CD process using run_test_job.sh flow.
 */

const fs = require('fs');
const _ = require('lodash');
const P = require('../../../util/promise');
const os_utils = require('../../../util/os_utils');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_ceph_s3');
const argv = require('minimist')(process.argv.slice(2));
delete argv._;
const { CEPH_TEST, DEFAULT_NUMBER_OF_WORKERS, TOX_ARGS, AWS4_TEST_SUFFIX } = require('./test_ceph_s3_constants.js');

const testing_status = {
    pass: [],
    fail: [],
    skip: [],
    total: 0
};

let tests_list;

const OUT_OF_SCOPE_TESTS = create_out_of_scope_tests_list() || [];
//Regexp match will be tested per each entry
const S3_CEPH_TEST_OUT_OF_SCOPE_REGEXP = new RegExp(`(${OUT_OF_SCOPE_TESTS.join('\\b)|(')}\\b)`);

async function main() {
    if (argv.help) usage();
    try {
        await run_s3_tests();
    } catch (err) {
        console.error(`Ceph Test Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

function usage() {
    console.log(`
Usage:
--ignore_lists      <path to list>,<path to list>,...
                    path to list is a text file with the tests in a format:
                    <directory name>...<directory name>.<file name without extension>.<test name>
                    for example:
                    s3tests_boto3.functional.test_s3.test_bucket_listv2_maxkeys_zero
--concurrency       <integer>
                    set the number of workers to run the tests. 
`);
    process.exit(0);
}

async function run_s3_tests() {
    try {
        await run_all_tests();
    } catch (err) {
        console.error('Failed running ceph tests', err);
        throw new Error('Running Ceph Tests Failed');
    }

    console.info(`CEPH TEST SUMMARY: Suite contains ${testing_status.total}, ran ${testing_status.pass.length + testing_status.fail.length + testing_status.skip.length} tests, Passed: ${testing_status.pass.length}, Skipped: ${testing_status.skip.length}, Failed: ${testing_status.fail.length}`);
    if (testing_status.skip.length) {
        console.warn(`CEPH TEST SKIPPED TESTS SUMMARY:  ${testing_status.skip.length} skipped tests \n${testing_status.skip.join('\n')}`);
    }
    if (testing_status.fail.length) {
        console.error(`CEPH TEST FAILED TESTS SUMMARY: ${testing_status.fail.length} failed tests \n${testing_status.fail.join('\n')}`);
        throw new Error('Ceph Tests Returned with Failures');
    }
}

async function run_all_tests() {
    console.info('Running Ceph S3 Tests...');
    const tests_list_command =
        `S3TEST_CONF=${process.cwd()}/${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config} tox ${TOX_ARGS} -- -q --collect-only --disable-pytest-warnings  2>&1 | awk '{print $1}' | grep "::test"`;
    try {
        tests_list = await os_utils.exec(tests_list_command, { ignore_rc: false, return_stdout: true });
    } catch (err) {
        console.error('Failed getting tests list');
        throw new Error(`Failed getting tests list ${err}`);
    }
    tests_list = tests_list.split('\n');
    testing_status.total = tests_list.length;
    const number_of_workers = argv.concurrency || DEFAULT_NUMBER_OF_WORKERS;
    console.info('Number of workers (concurrency):', number_of_workers);
    await P.map(_.times(number_of_workers), test_worker);
    console.log('Finished Running Ceph S3 Tests');
}

async function test_worker() {
    for (;;) {
        const test = tests_list.shift();
        if (!test) return;
        await run_single_test(test);
    }
}

async function run_single_test(test) {
    let ceph_args = `S3TEST_CONF=${process.cwd()}/${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`;
    if (test.endsWith(AWS4_TEST_SUFFIX)) {
        ceph_args += ` S3_USE_SIGV4=true`;
    }
    const base_cmd = `${ceph_args} tox ${TOX_ARGS}`;
    if (!S3_CEPH_TEST_OUT_OF_SCOPE_REGEXP.test(test)) {
        try {
            const full_test_command = `${base_cmd} ${process.cwd()}/${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}${test}`;
            const res = await os_utils.exec(full_test_command, { ignore_rc: false, return_stdout: true });
            if (res.includes('skipped')) {
                console.warn('Test skipped:', test);
                testing_status.skip.push(test);
            } else {
                console.info('Test Passed:', test);
                testing_status.pass.push(test);
            }
        } catch (err) {
            // tox will exit with code 1 on error regardless of pytest exit code. pytest exit code 5 means no tests ran.
            // can happen when 'not fails_on_rgw' flag is on for some tests (there are no boto3 tests for the test)
            if (err.stdout.includes("exited with code 5")) {
                console.warn('Test skipped:', test);
                testing_status.skip.push(test);
            } else {
                console.error('Test Failed:', test);
                testing_status.fail.push(test);
            }
        }
    }
}

function create_out_of_scope_tests_list() {
    const ignore_lists_paths = argv.ignore_lists?.split(',');
    if (ignore_lists_paths && ignore_lists_paths.length >= 1) {
        let out_of_scope_tests_list = [];
        for (const ignore_lists_path of ignore_lists_paths) {
            const list_content = fs.readFileSync(ignore_lists_path).toString().trim();
            if (list_content === "") continue; // in case someone added accidentally an empty list we ignore it
            const ignore_list = list_content.split("\n");
            out_of_scope_tests_list = _.concat(out_of_scope_tests_list, ignore_list);
        }
        return out_of_scope_tests_list;
    }
}

if (require.main === module) {
    main();
}
