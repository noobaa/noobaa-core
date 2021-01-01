/* Copyright (C) 2020 NooBaa */
'use strict';

const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('noobaa-core');
dbg.original_console();

const nsfs_cmd = require('./nsfs');
const nscache_cmd = require('./nscache');

const CORE_COMMANDS = Object.freeze({
    nsfs: nsfs_cmd,
    nscache: nscache_cmd,
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
    console.warn(USAGE.trimLeft());
    console.warn(COMMANDS.trimLeft());
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

if (require.main === module) main();
