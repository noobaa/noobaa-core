/* Copyright (C) 2016 NooBaa */
"use strict";

/**
 * This script is used as a part of the CI/CD process to run all Ceph S3 tests.
 * It uses the file setup_ceph_s3_config as prior configuration.
 * In the past this script was a part of the CI/CD process using run_test_job.sh flow.
 *
 * Runs in-scope tests in serial tox/pytest sessions (default and SigV4)
 * instead of one tox process per test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const _ = require('lodash');
const xml2js = require('xml2js');
const os_utils = require('../../../util/os_utils');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_ceph_s3');
const argv = require('minimist')(process.argv.slice(2));
delete argv._;
const { CEPH_TEST, TOX_ARGS, AWS4_TEST_SUFFIX } = require('./test_ceph_s3_constants.js');

const testing_status = {
    pass: [],
    fail: [],
    skip: [],
    total: 0
};

/**
 * Converts an ignore-list entry to canonical pytest nodeid form.
 * A pytest nodeid is pytest's id for a collected test, usually
 * path/to/file.py::test_name (and optional [param] for parametrized tests).
 * Dotted entries are accepted for compatibility.
 * Path-style file entries (contain / or end with .py) are left unchanged.
 * @param {string} entry
 * @returns {string}
 */
function normalize_to_pytest_nodeid(entry) {
    const trimmed = entry.trim().replace(/\\/g, '/');
    if (!trimmed) return trimmed;
    if (trimmed.includes('::')) return trimmed;
    // Do not treat path or bare .py file entries as dotted nodeids
    // (e.g. test_s3_website.py must not become test_s3_website.py::py).
    if (trimmed.includes('/') || trimmed.endsWith('.py')) return trimmed;
    const parts = trimmed.split('.').filter(Boolean);
    if (parts.length < 2) return trimmed;
    const test_name = parts.pop();
    return `${parts.join('/')}.py::${test_name}`;
}

/**
 * Builds exact and file-prefix matchers for ignore-list entries.
 * File-level entries match that file and all tests under it, including parametrized ids.
 * @param {string[]} out_of_scope_tests
 * @returns {{ exact: Set<string>, file_prefixes: string[] }}
 */
function build_out_of_scope_matchers(out_of_scope_tests) {
    const exact = new Set();
    const file_prefixes = [];
    const normalized = _.uniq(out_of_scope_tests.map(normalize_to_pytest_nodeid).filter(Boolean));
    for (const entry of normalized) {
        if (entry.includes('::')) {
            exact.add(entry);
        } else if (entry.endsWith('.py') || entry.includes('/')) {
            file_prefixes.push(entry);
        } else {
            exact.add(entry);
        }
    }
    return { exact, file_prefixes };
}

const OUT_OF_SCOPE_TESTS = create_out_of_scope_tests_list() || [];
const OUT_OF_SCOPE_MATCHERS = build_out_of_scope_matchers(OUT_OF_SCOPE_TESTS);

const S3TEST_CONF_PATH = path.join(process.cwd(), CEPH_TEST.test_dir, CEPH_TEST.ceph_config);
const S3_TESTS_ROOT = path.join(process.cwd(), CEPH_TEST.test_dir, CEPH_TEST.s3_test_dir);

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
                    path to list is a text file with pytest nodeids, either:
                    path-style: s3tests_boto3/functional/test_s3.py::test_bucket_listv2_maxkeys_zero
                    or dotted:  s3tests_boto3.functional.test_s3.test_bucket_listv2_maxkeys_zero
--concurrency       <integer>
                    reserved for future pytest-xdist use. Currently unused (serial tox sessions).
`);
    process.exit(0);
}

/**
 * Returns true when the collected test nodeid matches an ignore-list entry.
 * Exact nodeids (path/file.py::test_name) match only themselves.
 * File-level entries match that file and every test under it, including
 * parametrized ids such as test_routing_generator[t0] (a trailing word-boundary
 * regexp would miss those because ] is not a word character).
 * @param {string} test
 * @returns {boolean}
 */
function is_out_of_scope_test(test) {
    const nodeid = normalize_to_pytest_nodeid(test);
    if (OUT_OF_SCOPE_MATCHERS.exact.has(nodeid)) return true;
    // File / path prefixes from the ignore lists:
    // - "dir/file.py" matches that file and "dir/file.py::..."
    // - bare "file.py" also matches ".../file.py" and ".../file.py::..."
    // - non-.py path prefix matches that path and children ("prefix/..." or "prefix::...")
    return OUT_OF_SCOPE_MATCHERS.file_prefixes.some(prefix => {
        if (prefix.endsWith('.py')) {
            if (prefix.includes('/')) {
                return nodeid === prefix || nodeid.startsWith(`${prefix}::`);
            }
            return nodeid === prefix ||
                nodeid.startsWith(`${prefix}::`) ||
                nodeid.includes(`/${prefix}::`) ||
                nodeid.endsWith(`/${prefix}`);
        }
        return nodeid === prefix ||
            nodeid.startsWith(`${prefix}/`) ||
            nodeid.startsWith(`${prefix}::`);
    });
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

/**
 * Collects pytest nodeids via tox and returns their exit status without a pipe that hides tox's return code.
 * @param {string} run_tmpdir - Unique temp directory for this harness invocation
 * @returns {Promise<{ collected_tests: string[], exit_code: number, collect_log: string }>}
 */
async function collect_pytest_nodeids(run_tmpdir) {
    const collect_log = path.join(run_tmpdir, 'ceph_s3_collect.log');
    // Capture tox's return code directly. A trailing pipeline (awk|grep) would replace tox's status.
    const cmd =
        `S3TEST_CONF=${S3TEST_CONF_PATH} tox ${TOX_ARGS} -- -q --collect-only --disable-pytest-warnings > ${collect_log} 2>&1; echo $?`;
    const exit_str = await os_utils.exec(cmd, { ignore_rc: false, return_stdout: true });
    const exit_code = Number.parseInt(String(exit_str).trim(), 10);
    const collected_tests = fs.readFileSync(collect_log, 'utf8')
        .split('\n')
        .map(line => line.trim().split(/\s+/)[0])
        .filter(tok => tok.includes('::test'));
    return { collected_tests, exit_code, collect_log };
}

/**
 * Collects pytest nodeids, drops ignore-list entries, then runs two serial tox sessions.
 */
async function run_all_tests() {
    console.info('Running Ceph S3 Tests...');
    const run_tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceph_s3_'));
    try {
        let collected_tests;
        try {
            const collect_result = await collect_pytest_nodeids(run_tmpdir);
            if (!Number.isFinite(collect_result.exit_code) || collect_result.exit_code !== 0) {
                const log_tail = fs.existsSync(collect_result.collect_log) ?
                    fs.readFileSync(collect_result.collect_log, 'utf8').slice(-4000) : '';
                throw new Error(
                    `tox collect-only exited with code ${collect_result.exit_code}. Log tail:\n${log_tail}`
                );
            }
            collected_tests = collect_result.collected_tests;
            if (!collected_tests.length) {
                throw new Error('tox collect-only succeeded but no pytest nodeids were parsed');
            }
        } catch (err) {
            console.error('Failed getting tests list');
            throw new Error(`Failed getting tests list ${err}`);
        }
        const in_scope_tests = collected_tests.filter(test => !is_out_of_scope_test(test));
        const out_of_scope_count = collected_tests.length - in_scope_tests.length;
        testing_status.total = in_scope_tests.length;
        console.info(`Collected ${collected_tests.length} tests, in_scope: ${in_scope_tests.length}, out_of_scope: ${out_of_scope_count}`);
        console.info('Running single tox sessions with serial pytest (no xdist)');

        const default_tests = in_scope_tests.filter(test => !test.endsWith(AWS4_TEST_SUFFIX));
        const aws4_tests = in_scope_tests.filter(test => test.endsWith(AWS4_TEST_SUFFIX));
        console.info(`Default session tests: ${default_tests.length}, SigV4 (_aws4) session tests: ${aws4_tests.length}`);

        await run_tox_session({
            tests: default_tests,
            use_sigv4: false,
            label: 'default',
            run_tmpdir,
        });
        await run_tox_session({
            tests: aws4_tests,
            use_sigv4: true,
            label: 'aws4',
            run_tmpdir,
        });
        console.log('Finished Running Ceph S3 Tests');
    } finally {
        fs.rmSync(run_tmpdir, { recursive: true, force: true });
    }
}

/**
 * Returns true for pytest exit codes that mean the runner aborted (not mere test failures).
 * @param {number} exit_code
 * @returns {boolean}
 */
function is_pytest_runner_abort_exit(exit_code) {
    // pytest: 2 interrupted, 3 internal error, 4 usage error
    return exit_code === 2 || exit_code === 3 || exit_code === 4;
}

/**
 * Runs one tox/pytest session for the given nodeids and records results from JUnit XML.
 * @param {{ tests: string[], use_sigv4: boolean, label: string, run_tmpdir: string }} options
 */
async function run_tox_session(options) {
    const { tests, use_sigv4, label, run_tmpdir } = options;
    if (!tests.length) {
        console.info(`Skipping ${label} tox session: no tests`);
        return;
    }

    const junit_path = path.join(run_tmpdir, `ceph_s3_junit_${label}.xml`);
    const log_path = path.join(run_tmpdir, `ceph_s3_tox_${label}.log`);

    const nodeid_args = tests.map(test => path.join(S3_TESTS_ROOT, test)).join(' ');
    let env_prefix = `S3TEST_CONF=${S3TEST_CONF_PATH}`;
    if (use_sigv4) {
        env_prefix += ' S3_USE_SIGV4=true';
    }
    // Redirect output so a large suite cannot blow maxBuffer. Echo tox/pytest rc after the run
    // so we can parse JUnit for exit 0/1 while still rejecting runner aborts (2/3/4).
    const cmd =
        `${env_prefix} tox ${TOX_ARGS} -- --disable-pytest-warnings --tb=no -q --junitxml=${junit_path} ${nodeid_args} > ${log_path} 2>&1; echo $?`;
    console.info(`Running ${label} tox session with ${tests.length} tests...`);
    const exit_str = await os_utils.exec(cmd, { ignore_rc: false, return_stdout: true });
    const exit_code = Number.parseInt(String(exit_str).trim(), 10);
    await record_results_from_junit(junit_path, tests, log_path, label);
    if (!Number.isFinite(exit_code)) {
        throw new Error(`Tox/pytest ${label} session returned invalid exit status: ${exit_str}`);
    }
    if (is_pytest_runner_abort_exit(exit_code)) {
        throw new Error(`Tox/pytest ${label} session aborted with exit code ${exit_code}`);
    }
}

/**
 * Maps a pytest JUnit testcase classname+name back to an s3-tests nodeid.
 * @param {string} classname
 * @param {string} name
 * @returns {string}
 */
function junit_testcase_to_nodeid(classname, name) {
    return `${classname.replace(/\./g, '/')}.py::${name}`;
}

/**
 * Finds the expected in-scope nodeid that matches a JUnit-derived nodeid.
 * @param {string} junit_nodeid
 * @param {string[]} expected_tests
 * @returns {string|undefined}
 */
function match_expected_nodeid(junit_nodeid, expected_tests) {
    if (expected_tests.includes(junit_nodeid)) return junit_nodeid;
    const test_name = junit_nodeid.split('::').pop();
    const matches = expected_tests.filter(test => test === junit_nodeid || test.endsWith(`::${test_name}`));
    if (matches.length === 1) return matches[0];
    const by_suffix = expected_tests.find(test => junit_nodeid.endsWith(test) || test.endsWith(junit_nodeid));
    return by_suffix;
}

/**
 * Walks a parsed JUnit document and returns flat testcase objects.
 * @param {object} parsed
 * @returns {object[]}
 */
function collect_junit_testcases(parsed) {
    const testcases = [];
    const suites = [];
    if (parsed.testsuites) {
        const suite_list = parsed.testsuites.testsuite || [];
        for (const suite of Array.isArray(suite_list) ? suite_list : [suite_list]) {
            suites.push(suite);
        }
    } else if (parsed.testsuite) {
        suites.push(parsed.testsuite);
    }
    for (const suite of suites) {
        const cases = suite.testcase || [];
        for (const testcase of Array.isArray(cases) ? cases : [cases]) {
            testcases.push(testcase);
        }
    }
    return testcases;
}

/**
 * Records pass/fail/skip from a pytest JUnit XML file into testing_status.
 * @param {string} junit_path
 * @param {string[]} expected_tests
 * @param {string} log_path
 * @param {string} label
 */
async function record_results_from_junit(junit_path, expected_tests, log_path, label) {
    if (!fs.existsSync(junit_path)) {
        const log_tail = fs.existsSync(log_path) ? fs.readFileSync(log_path, 'utf8').slice(-4000) : '';
        console.error(`Missing JUnit file for ${label} session at ${junit_path}. Tox log tail:\n${log_tail}`);
        for (const test of expected_tests) {
            console.error('Test Failed:', test);
            testing_status.fail.push(test);
        }
        return;
    }

    const xml = fs.readFileSync(junit_path, 'utf8');
    const parsed = await xml2js.parseStringPromise(xml);
    const testcases = collect_junit_testcases(parsed);
    const recorded = new Set();

    for (const testcase of testcases) {
        const classname = testcase.$?.classname || '';
        const name = testcase.$?.name || '';
        const junit_nodeid = junit_testcase_to_nodeid(classname, name);
        const test = match_expected_nodeid(junit_nodeid, expected_tests) || junit_nodeid;
        recorded.add(test);

        if (testcase.failure || testcase.error) {
            console.error('Test Failed:', test);
            testing_status.fail.push(test);
        } else if (testcase.skipped) {
            console.warn('Test skipped:', test);
            testing_status.skip.push(test);
        } else {
            console.info('Test Passed:', test);
            testing_status.pass.push(test);
        }
    }

    for (const test of expected_tests) {
        if (recorded.has(test)) continue;
        // Selected to run but missing from JUnit means the session did not execute it.
        console.error('Test Failed:', test);
        testing_status.fail.push(test);
    }
}

/**
 * Loads ignore-list paths from --ignore_lists into a flat array of nodeid patterns.
 * @returns {string[]|undefined}
 */
function create_out_of_scope_tests_list() {
    const ignore_lists_paths = argv.ignore_lists?.split(',');
    if (ignore_lists_paths && ignore_lists_paths.length >= 1) {
        let out_of_scope_tests_list = [];
        for (const ignore_lists_path of ignore_lists_paths) {
            const list_content = fs.readFileSync(ignore_lists_path).toString().trim();
            if (list_content === "") continue; // in case someone added accidentally an empty list we ignore it
            const ignore_list = list_content.split('\n')
                .map(line => normalize_to_pytest_nodeid(line))
                .filter(Boolean);
            out_of_scope_tests_list = _.concat(out_of_scope_tests_list, ignore_list);
        }
        return out_of_scope_tests_list;
    }
}

if (require.main === module) {
    main();
}
