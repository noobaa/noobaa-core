/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const server_ops = require('../utils/server_functions');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const argv = require('minimist')(process.argv, { string: ['server_secret'] });
dbg.set_process_name('system_config_pipeline');

const js_script = 'system_config.js';

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
        let path = set_code_path(TEST_CFG.version);
        const flags = ['--skip_create_system'];
        try {
            if (TEST_CFG.version !== 'latest') {
                flags.push('--skip_report');
            }
            await run_test(path, flags); //will not call clean ova.
        } catch (err) {
            if (TEST_CFG.version === 'latest') {
                throw err;
            } else {
                console.error(`${js_script} failed in ${TEST_CFG.version}, ${err}`);
            }
        }
        await server_ops.upgrade_server(TEST_CFG.server_ip, TEST_CFG.upgrade);
        path = set_code_path('latest');
        await run_test(path, []);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
