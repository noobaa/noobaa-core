/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const util = require('util');
const path = require('path');
const argv = require('minimist')(process.argv);
const cluster = require('cluster');
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
Write modes:
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
const is_master = cluster.isMaster;
const speedometer = new Speedometer(is_master ? 'Total Speed' : 'FS Speed');
const start_time = Date.now();
const end_time = start_time + (argv.time * 1000);

let file_id = 0;

if (argv.forks > 1 && is_master) {
    speedometer.fork(argv.forks);
} else {
    main();
}

async function main() {
    const promises = [];
    fs.mkdirSync(argv.dir, { recursive: true });
    for (let i = 0; i < argv.concur; ++i) promises.push(writer(i));
    await Promise.all(promises);
    speedometer.clear_interval();
    if (is_master) speedometer.report();
    process.exit(0);
}

/**
 * @param {number} id
 */
async function writer(id) {
    const dir = path.join(
        argv.dir,
        `${id}`, // first level is id so that repeating runs will be collected together
        `pid-${process.pid}`,
    );
    await fs.promises.mkdir(dir, { recursive: true });

    for (;;) {
        const file_start_time = Date.now();
        if (file_start_time >= end_time) break;
        const file_path = path.join(dir, `file-${file_id}`);
        file_id += 1;
        if (argv.mode === 'nsfs') {
            await write_nb_native(file_path);
        } else if (argv.mode === 'nodejs') {
            await write_node_fs(file_path);
        } else if (argv.mode === 'dd') {
            await write_dd(file_path);
        }
        const took_ms = Date.now() - file_start_time;
        speedometer.add_op(took_ms);
    }
}

async function write_dd(file_path) {
    const cmd = `dd if=${argv.device} of=${file_path} bs=${block_size} count=${block_count}`;
    // console.log(cmd);
    await execAsync(cmd);
    if (argv.fsync) await execAsync(`sync ${file_path}`);
    speedometer.update(file_size_aligned);
}

async function write_nb_native(file_path) {
    const rand_stream = new RandStream(file_size_aligned, {
        highWaterMark: 2 * block_size,
        generator: argv.generator,
    });
    const fs_context = {
        // uid: 666,
        // gid: 666,
        backend: 'GPFS',
        warn_threshold_ms: 1000,
    };
    const file = await nb_native().fs.open(fs_context, file_path, 'w', 0x660);
    for (let pos = 0; pos < file_size_aligned; pos += block_size) {
        const buf_start_time = Date.now();
        if (buf_start_time >= end_time) break;
        const buf = rand_stream.generator(block_size);
        if (argv.nvec > 1) {
            await file.writev(fs_context, split_to_nvec(buf, argv.nvec));
        } else {
            await file.write(fs_context, buf);
        }
        speedometer.update(block_size);
    }
    if (argv.fsync) await file.fsync(fs_context);
    await file.close(fs_context);
}

async function write_node_fs(file_path) {
    const rand_stream = new RandStream(file_size_aligned, {
        highWaterMark: 2 * block_size,
        generator: argv.generator,
    });
    const file = await fs.promises.open(file_path, 'w', 0x660);
    for (let pos = 0; pos < file_size_aligned; pos += block_size) {
        const buf_start_time = Date.now();
        if (buf_start_time >= end_time) break;
        const buf = rand_stream.generator(block_size);
        if (argv.nvec > 1) {
            await file.writev(split_to_nvec(buf, argv.nvec));
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
