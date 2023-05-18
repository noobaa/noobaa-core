/* Copyright (C) 2020 NooBaa */
'use strict';

// load envs first
require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

// set the console output to raw
const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('noobaa-core');
dbg.original_console();

const minimist = require('minimist');
const api_cmd = require('./api');
const nsfs_cmd = require('./nsfs');
const backingstore_cmd = require('./backingstore');
const web_server = require('../server/web_server');
const endpoint = require('../endpoint/endpoint');
const bg_workers = require('../server/bg_workers');
const s3cat = require('../tools/s3cat');
// const s3perf = require('../tools/s3perf');
// const coding_speed = require('../tools/coding_speed');

const CORE_COMMANDS = Object.freeze({
    api: api_cmd,
    nsfs: nsfs_cmd,
    backingstore: backingstore_cmd,
    web: web_server,
    s3: endpoint,
    bg: bg_workers,
    s3cat,
    // s3perf,
    // coding_speed,
});

const HELP = `
Help:

    "noobaa-core" is a program that packages multiple core commands.
    Each command exposes a different core capability from the project.
    This form of packaging is meant for portability and ease of use during dev/test.
    Perhaps in the future this will become useful for deploying data services in production too.
`;

const USAGE = `
Usage:
    
    noobaa-core <command> --help            - Show help for command
    noobaa-core <command> [options...]      - Execute the command with options
`;

const COMMANDS = `
Commands:

${Object.keys(CORE_COMMANDS).map(cmd => '    - ' + cmd).join('\n')}
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(COMMANDS.trimStart());
    process.exit(1);
}

function main() {
    const argv = minimist(process.argv.slice(2));
    const cmd_name = argv._[0];
    const cmd = CORE_COMMANDS[cmd_name];
    if (!cmd) return print_usage();
    argv._.shift(); // remove the command name from arg list
    cmd.main(argv);
}

exports.main = main;

if (require.main === module) main();
