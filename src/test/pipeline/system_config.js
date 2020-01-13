/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const P = require('../../util/promise');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const server_ops = require('../utils/server_functions');
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'system_config';
dbg.set_process_name(test_name);

//noobaa rpc
let rpc;
let client;
let failures_in_test = false;

let errors = [];

const {
    mgmt_ip,
    mgmt_port_https,
    email = 'demo@noobaa.com',
    password = 'DeMo1',
    system = 'demo',
    skip_report = false,
    help = false
} = argv;

function usage() {
    console.log(`
    --mgmt_ip               -   noobaa server management ip.
    --mgmt_port_https       -   noobaa server management https port
    --email                 -   noobaa management Credentials (email)
    --password              -   noobaa management Credentials (password)
    --system                -   noobaa management Credentials (system)
    --skip_report           -   will skip sending report to mongo
    --id                    -   an id that is attached to the agents name
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

let report = new Report();
const cases = [
    'set_maintenance_mode',
    'update_n2n_config_single_port',
    'update_n2n_config_range',
    'set_debug_level_and_check',
    'set_diagnose_system',
];
report.init_reporter({ suite: test_name, conf: {}, mongo_report: true, cases: cases });

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

async function check_maintenance_mode(expected_mode) {
    const system_info = await client.system.read_system({});
    const is_mode_off = system_info.maintenance_mode.state;
    if (is_mode_off === expected_mode) {
        console.log(`The maintenance mode is ${is_mode_off} - as should`);
        await report.success(`set_maintenance_mode`);
    } else {
        saveErrorAndResume(`The maintenance mode is ${is_mode_off}`);
        await report.fail(`set_maintenance_mode`);
        throw new Error('Test set_maintenance_mode_and_check Failed');
    }
}

async function set_maintenance_mode(duration, delay_in_sec) {
    try {
        console.log(`Setting maintenance mode duration to ${duration}`);
        await client.system.set_maintenance_mode({ duration });
        console.log(`Sleeping for ${delay_in_sec} sec`);
        await P.delay(delay_in_sec * 1000);
    } catch (e) {
        await report.fail(`set_maintenance_mode`);
        throw new Error('Test set_maintenance_mode_and_check Failed');
    }
}

async function set_maintenance_mode_and_check() {
    try {
        console.log('Setting maintenance mode');
        await set_maintenance_mode(1, 10);
        await check_maintenance_mode(true);
        console.log(`Sleeping for 60 sec`);
        await P.delay(60 * 1000);
        await check_maintenance_mode(false);
        await set_maintenance_mode(30, 10);
        await set_maintenance_mode(0, 10);
        await check_maintenance_mode(false);
    } catch (e) {
        failures_in_test = true;
    }
}

async function update_n2n_config_and_check_single_port(port) {
    await client.system.update_n2n_config({
        config: {
            tcp_active: true,
            tcp_permanent_passive: { port }
        }
    });
    let system_info = await client.system.read_system({});
    const tcp_port = system_info.n2n_config.tcp_permanent_passive.port;
    let n2n_config = JSON.stringify(system_info.n2n_config);
    if (tcp_port === port) {
        console.log(`The single tcp port is: ${port} - as should`);
        await report.success(`update_n2n_config_single_port`);
    } else {
        saveErrorAndResume(`The single tcp port is ${n2n_config}`);
        await report.fail(`update_n2n_config_single_port`);
        throw new Error('Test update_n2n_config_and_check Failed');
    }
}

async function update_n2n_config_and_check_range(max, min) {
    await client.system.update_n2n_config({
        config: {
            tcp_active: true,
            tcp_permanent_passive: { max, min }
        }
    });
    const system_info = await client.system.read_system({});
    const tcp_port_min = system_info.n2n_config.tcp_permanent_passive.min;
    const tcp_port_max = system_info.n2n_config.tcp_permanent_passive.max;
    const n2n_config = JSON.stringify(system_info.n2n_config);
    if (tcp_port_min === min && tcp_port_max === max) {
        console.log(`The tcp port range is: ${min} to ${60500} - as should`);
        await report.success(`update_n2n_config_range`);
    } else {
        saveErrorAndResume(`The tcp port range is ${n2n_config}`);
        await report.fail(`update_n2n_config_range`);
        throw new Error('Test update_n2n_config_and_check Failed');
    }
}

async function update_n2n_config_and_check() {
    try {
        console.log('Updating n2n config mode');
        await update_n2n_config_and_check_single_port(60100);
        await update_n2n_config_and_check_range(60500, 60200);
    } catch (e) {
        failures_in_test = true;
    }
}

async function set_debug_level(level) {
    try {
        await client.cluster_server.set_debug_level({ level });
        const system_info = await client.system.read_system({});
        const debug_level = system_info.debug.level;
        if (debug_level === level) {
            console.log(`The debug level is: ${level} - as should`);
            await report.success(`set_debug_level_and_check`);
        } else {
            saveErrorAndResume(`The debug level is ${debug_level}`);
            throw new Error('Test set_debug_level_and_check Failed');
        }
    } catch (e) {
        await report.fail(`set_debug_level_and_check`);
        throw new Error('Test set_debug_level_and_check Failed');
    }
}

async function set_debug_level_and_check() {
    try {
        console.log('Setting debug level');
        //turn on debug level
        await set_debug_level(5);
        //turn off debug level
        await set_debug_level(0);
    } catch (e) {
        failures_in_test = true;
    }
}

async function set_diagnose_system_and_check() {
    try {
        console.log(`Setting Diagnostic`);
        const diagnose_system = await client.cluster_server.diagnose_system({});
        await P.delay(40 * 1000);
        if (diagnose_system.includes(`/public/${system}_cluster_diagnostics.tgz`)) {
            console.log(`The diagnose system file is: ${diagnose_system} - as should `);
            await report.success(`set_diagnose_system`);
        } else {
            saveErrorAndResume(`The diagnose system file is: ${diagnose_system}`);
            throw new Error('Test set_diagnose_system_and_check Failed');
        }
    } catch (e) {
        failures_in_test = true;
        await report.fail(`set_diagnose_system`);
    }
}

async function set_rpc_and_create_auth_token() {
    rpc = api.new_rpc_from_base_address('wss://' + mgmt_ip + ':' + mgmt_port_https, 'EXTERNAL');
    client = rpc.new_client({});
    const auth_params = {
        email,
        password,
        system
    };
    return client.create_auth_token(auth_params);
}

async function main() {
    try {
        if (skip_report) {
            report.pause();
        }
        await set_rpc_and_create_auth_token();
        rpc.disconnect_all();

        server_ops.init_reporter({
            suite_name: 'system_config',
            cases: [
                'create_system'
            ]
        });

        await set_maintenance_mode_and_check();
        await update_n2n_config_and_check();
        await set_debug_level_and_check();
        await set_diagnose_system_and_check();
        rpc.disconnect_all();
        await report.report();
        if (failures_in_test) {
            throw new Error(`Got error/s during test - exiting...`);
        } else {
            console.log('Test passed with no errors - exiting...');
            process.exit(0);
        }
    } catch (err) {
        await report.report();
        console.error(`${err}`);
        console.error(`${JSON.stringify(_.countBy(errors), null, 4)}`);
        process.exit(1);
    }
}

main();
