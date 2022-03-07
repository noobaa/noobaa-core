/* Copyright (C) 2020 NooBaa */
'use strict';

const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs-enc');
dbg.original_console();

const config = require('../../config');
const nb_native = require('../util/nb_native');

const HELP = `
Help:

    "nsfs-enc" is a tool to check weather a file path is encrypted or not using libGPFS 
`;

const USAGE = `
Usage:

    GPFS_DL_PATH=/tmp/libgpfs.so node nsfs-enc.js <file-path> [options...]
`;

const ARGUMENTS = `
Arguments:

    <file-path>      Set the file path to check if file is encrypted.
`;

const OPTIONS = `
Options:

    --uid <uid>             (default process uid)    Send requests to the Filesystem with uid.
    --gid <gid>             (default process gid)    Send requests to the Filesystem with gid.
    --filewrap <true/false> (default false)          Use FileWrapper instead of regular call.
    --debug <level>         (default 0)              Increase debug level
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimLeft());
    console.warn(ARGUMENTS.trimLeft());
    console.warn(OPTIONS.trimLeft());
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
        const file_path = argv._[0];
        dbg.log0('nsfs-enc: file_path', file_path);
        if (nb_native().fs.gpfs) {
            const fs_account_config = {
                uid: Number(argv.uid) || process.getuid(),
                gid: Number(argv.gid) || process.getgid(),
                backend: '',
                warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
            };
            let is_enc;
            if (argv.filewrap) {
                const file = await nb_native().fs.open(fs_account_config, file_path);
                const stat = await file.stat(fs_account_config);
                is_enc = Boolean(stat.xattr['gpfs.Encryption']);
                await file.close(fs_account_config);
            } else {
                const stat = await nb_native().fs.stat(fs_account_config, file_path);
                is_enc = Boolean(stat.xattr['gpfs.Encryption']);
            }
            dbg.log0('nsfs-enc: file is encrypted?', is_enc);
        }
    } catch (err) {
        console.error('nsfs-enc: exit on error', err.stack || err);
        process.exit(2);
    }
}

main();
