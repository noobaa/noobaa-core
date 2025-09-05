/* Copyright (C) 2020 NooBaa */
'use strict';

require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs');
dbg.original_console();

const util = require('util');
const minimist = require('minimist');
const api = require('../api');
const { make_auth_token } = require('../server/common_services/auth_server');

const HELP = `
Help:

    "api" is a cli command that makes API calls to a noobaa RPC server.
    API schemas can be found under src/api/*.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd api <api_name> <method_name> [<params>] [options...]
`;

const ARGUMENTS = `
Arguments:

    <api_name>          Api name from src/api/*
    <method_name>       Method name from api.methods
    <params>            JSON string of the params to send
`;

const OPTIONS = `
Options:

    --address <url>     (default per api type)           Set the address of the rpc server ()
    --debug <level>     (default 0)                      Increase debug level
    --token <token>                                      Token to authorize the request
    --json                                               Output raw json instead of printaable
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    process.exit(1);
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        dbg.original_console();
        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
        }
        const token = argv.token || make_auth_token({
            system: process.env.CREATE_SYS_NAME,
            role: 'admin',
            email: process.env.CREATE_SYS_EMAIL
        });

        const address = argv.address || 'wss://localhost:5443';
        const api_name = String(argv._[0] || '');
        const method_name = String(argv._[1] || '');
        const params = argv._[2] ? JSON.parse(argv._[2]) : undefined;
        if (!api_name) return print_usage();
        if (!method_name) return print_usage();

        const final_api_name = api_name.endsWith('_api') ? api_name.slice(0, -4) : api_name;
        const rpc = api.new_rpc();
        const client = rpc.new_client();
        client.options.auth_token = token;
        const res = await client[final_api_name][method_name](params, { address });
        if (argv.json) {
            console.log(JSON.stringify(res));
        } else {
            console.log(util.inspect(res, { colors: true, depth: null, showHidden: true, breakLength: 80 }));
        }
        process.exit(0);
    } catch (err) {
        console.error('api: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
