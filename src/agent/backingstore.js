/* Copyright (C) 2020 NooBaa */
'use strict';

require('../util/dotenv').load();

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('backingstore');

const system_store = require('../server/system_services/system_store');
system_store.get_instance({ standalone: true });

const Agent = require('./agent');
const fs_utils = require('../util/fs_utils');
const db_client = require('../util/db_client');
const nb_native = require('../util/nb_native');
const json_utils = require('../util/json_utils');
const server_rpc = require('../server/server_rpc');
const auth_server = require('../server/common_services/auth_server');

const HELP = `
Help:

    "backingstore" is a noobaa-core command runs a local backingstore agent
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/agent/backingstore [options...] <storage-url>
`;

const ARGUMENTS = `
Arguments:

    <storage-url>       Storage to use (e.g "s3://server:8080" or "data-dir/bucket-name")
`;

const OPTIONS = `
Options:

    --address <host:port>     (default wss://localhost:5443)   Set the base core address
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
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
        const address = argv.address || 'wss://localhost:5443';
        const rpc_port = String(argv.port || '');
        const storage = argv._[0];
        if (!storage) print_usage();
        if (!rpc_port) print_usage();

        console.warn(WARNINGS);
        console.log('backingstore: setting up ...', argv);

        if (!fs.existsSync(storage)) {
            console.error(`storage directory not found: ${storage}`);
            print_usage();
        }

        await db_client.instance().connect();
        server_rpc.register_common_services();
        await system_store.get_instance().load();
        const get_system = () => system_store.get_instance().data.systems[0];

        const conf_path = path.join(storage, 'agent_conf.json');
        const token_path = path.join(storage, 'token');
        const agent_conf = new json_utils.JsonFileWrapper(conf_path);
        if (!fs.existsSync(token_path)) {
            const system = get_system();
            await fs_utils.replace_file(
                token_path,
                auth_server.make_auth_token({
                    system_id: String(system._id),
                    account_id: system.owner._id,
                    role: 'create_node',
                })
            );
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
            rpc: server_rpc.rpc,
            rpc_port,
            address,
            routing_hint: 'LOOPBACK',
            node_name: storage,
            host_id: storage,
            location_info: {
                host_id: storage,
            },
            storage_path: storage,
            storage_limit: undefined,
            agent_conf,
            token_wrapper,
            create_node_token_wrapper,
        });

        await agent.start();

    } catch (err) {
        console.error('backingstore: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
