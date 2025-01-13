/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/panic');

const fs = require('fs');
const util = require('util');
const path = require('path');
const argv = require('minimist')(process.argv);
const { cluster } = require('../util/fork_utils');
const execAsync = util.promisify(require('child_process').exec);
const Speedometer = require('../util/speedometer');
const RandStream = require('../util/rand_stream');

function print_usage() {
    console.log(`
Usage:
  --help            show this usage
  --dir <path>      (default "./fs_speed_output") where to write the files
  --time <sec>      (default 10) limit time to run
  --concur <n>      (default 1) number of concurrent writers
  --forks <n>       (default 1) number of forks to create (total writers is concur * forks).
Sizes:
  --file_size  <n>          (default 1024 MB) file size to write 
  --block_size <n>          (default 8 MB) block size to write 
  --file_size_units <unit>  (default is "MB") options are "GB", "MB", "KB", "B"
  --block_size_units <unit> (default is "MB") options are "GB", "MB", "KB", "B"
Modes:
  --read            invoke reads instead of writes.
  --fsync           trigger fsync at the end of each file
  --mode <mode>     (default is "nsfs") options are
         "nsfs"     use the native fs_napi module used in nsfs
         "nodejs"   use nodejs fs module
         "dd"       execute dd commands
Advanced:
  --device <path>   (default is "/dev/zero") input device to use for dd mode
  --generator <x>   (default is "zeros") options are from rand stream (not for dd mode)
  --nvec <num>      (default is 1) split blocks to use writev if > 1 (not for dd mode)

Example:
    node src/tools/fs_speed --dir /mnt/fs/fs_speed_output --time 30 --concur 4 --file_size 256 --block_size 4 --fsync --mode dd
`);
}

if (argv.help) {
    print_usage();
    process.exit(0);
}

argv.dir = argv.dir || 'fs_speed_output';
argv.time = argv.time || 10; // stop after X seconds
argv.concur = argv.concur || 1;
argv.forks = argv.forks || 1;
argv.file_size = argv.file_size || 1024;
argv.block_size = argv.block_size || 8;
argv.file_size_units = argv.file_size_units || 'MB';
argv.block_size_units = argv.block_size_units || 'MB';
argv.fsync = Boolean(argv.fsync);
argv.mode = argv.mode || 'nsfs';
argv.backend = argv.backend || 'GPFS';
if (argv.mode === 'dd') {
    argv.device = argv.device || '/dev/zero';
} else {
    // flags that are ignored on dd mode
    // nvec larger than 1 will use writev instead of write
    argv.nvec = argv.nvec || 1;
    // generator value should be one that RandStream supports - 'crypto' | 'cipher' | 'fake' | 'zeros' | 'fill' | 'noinit'
    argv.generator = argv.generator || 'zeros';
}

Object.freeze(argv);
console.log(argv);

if (!['nsfs', 'nodejs', 'dd'].includes(argv.mode)) {
    throw new Error('Invalid mode ' + argv.mode);
}
const size_units_table = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
};
if (!size_units_table[argv.file_size_units]) {
    throw new Error('Invalid file_size_units ' + argv.file_size_units);
}
if (!size_units_table[argv.block_size_units]) {
    throw new Error('Invalid block_size_units ' + argv.block_size_units);
}

const block_size = argv.block_size * size_units_table[argv.block_size_units];
const file_size = argv.file_size * size_units_table[argv.file_size_units];
const block_count = Math.ceil(file_size / block_size);
const file_size_aligned = block_count * block_size;
const nb_native = argv.mode === 'nsfs' && require('../util/nb_native');
const is_master = cluster.isPrimary;
const start_time = Date.now();
const end_time = start_time + (argv.time * 1000);

const speedometer = new Speedometer('FS Speed');
speedometer.run_workers(argv.forks, main, argv);

async function main() {
    // nb_native().fs.set_debug_level(5);
    const promises = [];
    fs.mkdirSync(argv.dir, { recursive: true });
    for (let i = 0; i < argv.concur; ++i) promises.push(worker(i));
    await Promise.all(promises);
    speedometer.clear_interval();
    if (is_master) speedometer.report();
    process.exit(0);
}

/**
 * @param {number} id
 */
async function worker(id) {
    const dir = path.join(
        argv.dir,
        `${id}`, // first level is id so that repeating runs will be collected together
        // `pid-${process.pid}`,
    );
    await fs.promises.mkdir(dir, { recursive: true });

    let file_id = 0;
    for (;;) {
        const file_start_time = Date.now();
        if (file_start_time >= end_time) break;
        const file_path = path.join(dir, `file-${file_id}`);
        file_id += 1;
        try {
            if (argv.mode === 'nsfs') {
                await work_with_nsfs(file_path);
            } else if (argv.mode === 'nodejs') {
                await work_with_nodejs(file_path);
            } else if (argv.mode === 'dd') {
                await work_with_dd(file_path);
            }
            const took_ms = Date.now() - file_start_time;
            speedometer.add_op(took_ms);
        } catch (err) {
            if (argv.read && err.code === 'ENOENT') {
                file_id = 0;
            } else {
                throw err;
            }
        }
    }
}

async function work_with_dd(file_path) {
    const cmd = argv.read ?
        `dd if=${file_path} of=/dev/null bs=${block_size} count=${block_count}` :
        `dd if=${argv.device} of=${file_path} bs=${block_size} count=${block_count}`;
    // console.log(cmd);
    await execAsync(cmd);
    if (argv.fsync) await execAsync(`sync ${file_path}`);
    speedometer.update(file_size_aligned);
}

async function work_with_nsfs(file_path) {
    const rand_stream = new RandStream(file_size_aligned, {
        highWaterMark: 2 * block_size,
        generator: argv.read ? 'noinit' : argv.generator,
    });
    const fs_context = {
        // uid: 666,
        // gid: 666,
        backend: argv.backend,
        warn_threshold_ms: 10000,
    };
    const file = await nb_native().fs.open(fs_context, file_path, argv.read ? 'r' : 'w', 0o660);
    for (let pos = 0; pos < file_size_aligned; pos += block_size) {
        const buf_start_time = Date.now();
        if (buf_start_time >= end_time) break;
        const buf = rand_stream.generator(block_size);
        if (argv.nvec > 1) {
            if (argv.read) {
                // await file.readv(fs_context, split_to_nvec(buf, argv.nvec));
                throw new Error('TODO: readv is not yet available in NativeFile');
            } else {
                await file.writev(fs_context, split_to_nvec(buf, argv.nvec));
            }
        } else if (argv.read) {
            await file.read(fs_context, buf, 0, buf.length, pos);
        } else {
            await file.write(fs_context, buf, buf.length, pos);
        }
        speedometer.update(block_size);
    }
    if (argv.fsync) await file.fsync(fs_context);
    await file.close(fs_context);
}

async function work_with_nodejs(file_path) {
    const rand_stream = new RandStream(file_size_aligned, {
        highWaterMark: 2 * block_size,
        generator: argv.read ? 'noinit' : argv.generator,
    });
    const file = await fs.promises.open(file_path, argv.read ? 'r' : 'w', 0o660);
    for (let pos = 0; pos < file_size_aligned; pos += block_size) {
        const buf_start_time = Date.now();
        if (buf_start_time >= end_time) break;
        const buf = rand_stream.generator(block_size);
        if (argv.nvec > 1) {
            if (argv.read) {
                await file.readv(split_to_nvec(buf, argv.nvec));
            } else {
                await file.writev(split_to_nvec(buf, argv.nvec));
            }
        } else if (argv.read) {
            await file.read(buf);
        } else {
            await file.write(buf);
        }
        speedometer.update(block_size);
    }
    if (argv.fsync) await file.sync();
    await file.close();
}

function split_to_nvec(buf, nvec) {
    const len = Math.ceil(buf.length / nvec);
    const bufs = [];
    for (let p = 0; p < buf.length; p += len) {
        bufs.push(buf.slice(p, p + len));
    }
    return bufs;
}
