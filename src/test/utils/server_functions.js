/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const Report = require('../framework/report');
const P = require('../../util/promise');

let report = new Report();

//Enable reporter and set parameters
function init_reporter(report_params) {
    const suite_name = report_params.suite_name || 'UNKNW_server_func';
    report.init_reporter({
        suite: suite_name,
        conf: {},
        mongo_report: true,
        cases: report_params.cases,
        prefix: report_params.cases_prefix
    });
}

//will create a system and check that the default account status is true.
async function create_system(server_ip, port, protocol) {
    protocol = protocol || 'wss';
    const rpc = api.new_rpc_from_base_address(`${protocol}://${server_ip}:${port}`, 'EXTERNAL');
    const client = rpc.new_client({});
    try {
        await client.system.create_system({
            email: 'demo@noobaa.com',
            name: 'demo',
            password: 'DeMo1'
        });
        await wait_for_system_ready(server_ip, port, protocol);
    } catch (e) {
        console.error(`Couldn't create system`, e);
        throw e;
    }
}

// use account status as indication for system ready after create system
async function wait_for_system_ready(server_ip, port, protocol, timeout = 600 * 1000) {
    let has_account;
    const base_time = Date.now();
    while (Date.now() - base_time < timeout) {
        try {
            const rpc = api.new_rpc_from_base_address(`${protocol}://${server_ip}:${port}`, 'EXTERNAL');
            const client = rpc.new_client({});
            const auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            await client.create_auth_token(auth_params);
            const account_stat = await client.account.accounts_status({});
            has_account = account_stat.has_accounts;
            if (has_account) break;
        } catch (e) {
            await P.delay(5 * 1000);
        }
    }
    if (!has_account) {
        throw new Error(`Couldn't create system. no account`);
    }
}

async function get_num_optimal_agents(server_ip, port) {
    const rpc = api.new_rpc_from_base_address(`wss://${server_ip}:${port}`, 'EXTERNAL');
    const client = rpc.new_client({});
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    await client.create_auth_token(auth_params);
    return (await client.host.list_hosts({
        query: {
            mode: ['OPTIMAL']
        }
    })).hosts.length;
}

exports.init_reporter = init_reporter;
exports.create_system = create_system;
exports.wait_for_system_ready = wait_for_system_ready;
exports.get_num_optimal_agents = get_num_optimal_agents;
