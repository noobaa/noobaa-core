/* Copyright (C) 2020 NooBaa */
'use strict';

// load envs first
require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const minimist = require('minimist');

// using functions to avoid loading modules until the actual command is parsed from args
const CORE_COMMANDS = Object.freeze({
    api: () => require('./api'),
    nsfs: () => require('./nsfs'),
    backingstore: () => require('./backingstore'),
    web: () => require('../server/web_server'),
    s3: () => require('../endpoint/endpoint'),
    bg: () => require('../server/bg_workers'),
    s3cat: () => require('../tools/s3cat'),
    health: () => require('./health'),
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
    cmd().main(argv);
}

exports.main = main;

if (require.main === module) main();
