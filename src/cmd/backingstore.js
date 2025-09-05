/* Copyright (C) 2020 NooBaa */
'use strict';

require('../util/dotenv').load();

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('backingstore');
dbg.original_console();

const api = require('../api');
const Agent = require('../agent/agent');
const fs_utils = require('../util/fs_utils');
const nb_native = require('../util/nb_native');
const json_utils = require('../util/json_utils');
const { make_auth_token } = require('../server/common_services/auth_server');

const HELP = `
Help:

    "backingstore" is a noobaa-core command runs a local backingstore agent
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/agent/backingstore <storage-path> [options...]
`;

const ARGUMENTS = `
Arguments:

    <storage-path>      Storage dir to use (e.g "data-dir/bucket-name")
`;

const OPTIONS = `
Options:

    --port <port>       (required!)                      Listening port for backingstore incoming requests
    --address <url>     (default wss://localhost:5443)   The address of the base core server
    --pool_name <name>  (default backingstores)          The pool to add this backingstore
    --debug <level>     (default 0)                      Increase debug level
`;

const WARNINGS = `
WARNING:

    !!! This feature is WORK IN PROGRESS and can change without notice !!!
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    console.warn(WARNINGS.trimStart());
    process.exit(1);
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 0;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
        const port = String(argv.port || '');
        const address = argv.address || 'wss://localhost:5443';
        const pool_name = argv.pool_name || 'backingstores';
        const storage_path = argv._[0];

        if (!port) print_usage();
        if (!storage_path) print_usage();

        console.warn(WARNINGS);
        console.log('backingstore: setting up ...', argv);

        if (!fs.existsSync(storage_path)) {
            console.error(`storage directory not found: ${storage_path}`);
            print_usage();
        }

        await run_backingstore(storage_path, address, port, pool_name);

    } catch (err) {
        console.error('backingstore: exit on error', err.stack || err);
        process.exit(2);
    }
}

async function run_backingstore(storage_path, address, port, pool_name) {

    const conf_path = path.join(storage_path, 'agent_conf.json');
    const token_path = path.join(storage_path, 'token');
    const agent_conf = new json_utils.JsonFileWrapper(conf_path);

    if (!fs.existsSync(token_path)) {
        const rpc = api.new_rpc();
        const client = rpc.new_client({ address });
        client.options.auth_token = make_auth_token({
            system: process.env.CREATE_SYS_NAME,
            role: 'admin',
            email: process.env.CREATE_SYS_EMAIL
        });
        const install_string = await client.pool.get_hosts_pool_agent_config({ name: pool_name });
        const install_conf = JSON.parse(Buffer.from(install_string, 'base64').toString());
        await fs_utils.replace_file(token_path, install_conf.create_node_token);
    }

    const token_wrapper = {
        read: () => fs.promises.readFile(token_path),
        write: token => fs_utils.replace_file(token_path, token),
    };
    const create_node_token_wrapper = {
        read: () => agent_conf.read().then(conf => conf.create_node_token),
        write: new_token => agent_conf.update({ create_node_token: new_token }),
    };

    const agent = new Agent({
        address,
        rpc_port: port,
        node_name: storage_path,
        host_id: storage_path,
        location_info: {
            host_id: storage_path,
        },
        storage_path,
        storage_limit: undefined,
        agent_conf,
        token_wrapper,
        create_node_token_wrapper,
    });

    await agent.start();
}

exports.main = main;

if (require.main === module) main();
