/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const crypto = require('crypto');
const dataset = require('./dataset.js');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const { PoolFunctions } = require('../utils/pool_functions');

const test_name = 'dataset';
dbg.set_process_name(test_name);

const TEST_CFG_DEFAULTS = {
    mgmt_ip: 'localhost',
    mgmt_port_https: 8443,
    s3_ip: '',
    s3_port_https: 443,
    agent_number: 0,
    access_key: 123,
    secret_key: 'abc',
    bucket: 'first.bucket', // default bucket
    part_num_low: 2, // minimum 2 part - up to 100MB
    part_num_high: 10, // maximum 10 parts - down to 5MB - s3 minimum
    aging_timeout: 0, // time running in minutes
    max_depth: 1, // the maximum depth
    min_depth: 10, // the minimum depth
    size_units: 'MB', // the default units of the size is MB
    file_size_low: 50, // minimum 50MB
    file_size_high: 200, // maximum 200Mb
    dataset_size: 10, // DS of 10GB
    versioning: false,
    no_exit_on_success: false,
    data_placement: 'SPREAD',
    seed: crypto.randomBytes(10).toString('hex')
};

const dataset_params = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
const POOL_NAME = "first-pool";

async function _run_dataset() {
    console.log(dataset_params);
    const report_params = {
        suite_name: 'run_dataset',
    };
    await dataset.init_parameters({ dataset_params, report_params });
    try {
        await dataset.run_test(true);
    } catch (e) {
        console.log('Failed running dataset');
        throw e;
    }
}

async function _create_pool(agent_number, mgmt_ip, mgmt_port_https) {
    if (agent_number !== 0) {
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
        const client = rpc.new_client({});
        try {
            await client.create_auth_token({
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            });
        } catch (e) {
            console.error(`create_auth_token has failed`, e);
            process.exit(1);
        }
        const pool_functions = new PoolFunctions(client);
        await pool_functions.create_pool(POOL_NAME, agent_number);
        await pool_functions.change_tier(POOL_NAME, dataset_params.bucket, dataset_params.data_placement);
    }
}

async function main() {
    console.log(`running dataset`);
    try {
        await _create_pool(dataset_params.agent_number, dataset_params.mgmt_ip, dataset_params.mgmt_port_https);
        await _run_dataset();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
