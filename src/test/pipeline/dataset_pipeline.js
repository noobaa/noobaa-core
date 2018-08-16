/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const argv = require('minimist')(process.argv, { string: ['server_secret'] });
dbg.set_process_name('account_pipeline');

const js_script = 'dataset.js';

const TEST_CFG_DEFAULTS = {
    server_ip: '127.0.0.1',
    server_secret: '',
    upgrade: '',
    version: 'latest'
};

let TEST_CFG = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
Object.freeze(TEST_CFG);

function set_code_path(version) {
    const test_path = 'src/test/qa/';
    if (version === 'latest') {
        return `./${test_path}`;
    } else {
        return `/noobaaversions/${version}/noobaa-core/${test_path}`;
    }
}

async function run_test(path, flags) {
    try {
        await promise_utils.fork(path + js_script, flags.concat(process.argv));
    } catch (err) {
        console.log('Failed running script', js_script);
        throw err;
    }
}

async function main() {
    console.log(`running ${js_script} flow in the pipeline`);
    try {
        const path = set_code_path('latest');
        await run_test(path, ['--aging_timeout', 60, '--dataset_size', (30 * 1024), '--size_units', 'MB']);
        await run_test(path, ['--aging_timeout', 60, '--file_size_low', 750, '--file_size_high', 4096,
            '--part_num_low', 20, '--part_num_high', 150, '--dataset_size', (30 * 1024), '--size_units', 'MB'
        ]);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
