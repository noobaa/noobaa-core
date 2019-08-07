/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto = require('crypto');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const test_utils = require('../system_tests/test_utils');
const { AgentFunctions } = require('../utils/agent_functions');

// Environment Setup
const shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

const testName = 'agents_matrix';
const POOL_NAME = "first-pool";
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name(testName);

// Sample Config
const argv = require('minimist')(process.argv);
console.log(JSON.stringify(argv));

const {
    mgmt_ip,
    mgmt_port,
    s3_ip,
    s3_port,
    bucket = 'first.bucket',
} = argv;

const agent_functions = new AgentFunctions();
const s3ops = new S3OPS({ ip: s3_ip, port: s3_port });

function usage() {
    //TODO: fix the help
    console.log(`
    --bucket                -   bucket to run on (default: ${bucket})
    --mgmt_ip               -   noobaa server ip
    --help                  -   show this help
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

//noobaa rpc
const api = require('../../api');
const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port}`, 'EXTERNAL');
const client = rpc.new_client({});

let nodes = [];
let errors = [];

function saveErrorAndExit(message) {
    console.error(message);
    errors.push(message);
    process.exit(1);
}

async function runAgentDiagnostics() {
    console.warn(`Will take diagnostics from all the agents`);
    await P.map(nodes, async name => {
        try {
            await client.node.collect_agent_diagnostics({ name });
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
}

async function runAgentDebug() {
    console.warn(`Will put all agents in debug mode`);
    await P.map(nodes, async name => {
        try {
            await client.node.set_debug_node({
                node: {
                    name
                },
                level: 5,
            });
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
}

async function verifyAgent() {
    console.log(`Starting the verify agents stage`);
    await s3ops.put_file_with_md5(bucket, '100MB_File', 100, 1048576);
    await s3ops.get_file_check_md5(bucket, '100MB_File');
    await runAgentDiagnostics();
    await runAgentDebug();
}

async function active_de_active_hosts() {
    //enabling the entire host or enabling with random number of agents enabled
    await agent_functions.deactivateAllHosts(mgmt_ip, mgmt_port);
    //verifying write, read, diag and debug level.
    await verifyAgent();
    //disabling the entire host
    await agent_functions.activeAllHosts(mgmt_ip, mgmt_port);
}

async function main() {
    //running the main cycle:
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
    await test_utils.create_hosts_pool(client, POOL_NAME, 3);
    try {
        await active_de_active_hosts();
    } catch (e) {
        saveErrorAndExit(e);
    }
    await rpc.disconnect_all();
    console.warn('End of Test, cleaning.');
    if (errors.length === 0) {
        console.log('All is good - exiting...');
        process.exit(0);
    } else {
        console.log('Got the following errors in test:');
        for (const error of errors) {
            console.error('Error:: ', error);
        }
        console.log('Failures in test - exiting...');
        process.exit(1);
    }

}

main();
