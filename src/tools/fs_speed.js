/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/panic');

const fs = require('fs');
const util = require('util');
const path = require('path');
const crypto = require('crypto');
const argv = require('minimist')(process.argv);
const execAsync = util.promisify(require('child_process').exec);
const Speedometer = require('../util/speedometer');

function print_usage() {
    console.log(`
Usage:
  --help            show this usage
  --path <path>     (default "./fs_speed_output") where to write the files
  --time <sec>      (default 10) limit time to run
  --concur <n>      (default 1) number of concurrent writers
  --forks <n>       (default 1) number of forks to create (total writers is concur * forks).
Modes:
  --direct          use direct I/O for read (default is false)
  --write           do write test (default is false)
  --fsync           trigger fsync at the end of each file (default is true)
  --mode <mode>     (default is "nsfs") options are
         "nsfs"     use the native fs_napi module used in nsfs
         "nodejs"   use nodejs fs module
         "dd"       execute dd commands
Sizes:
  --file_size  <n>          (default 64 MB) file size to write 
  --block_size <n>          (default 8 MB) block size to write 
  --file_size_units <unit>  (default is "MB") options are "GB", "MB", "KB", "B"
  --block_size_units <unit> (default is "MB") options are "GB", "MB", "KB", "B"
Advanced:
  --device <path>   (default is "/dev/zero") input device to use for dd mode
  --nvec <num>      (default is 1) split blocks to use writev if > 1 (not for dd mode)

Example:
    node src/tools/fs_speed --path /mnt/fs/fs_speed_output --time 30 --forks 16
`);
}

if (argv.help) {
    print_usage();
    process.exit(0);
}

argv.path = argv.path || 'fs_speed_output';
argv.write = Boolean(argv.write || false);
argv.direct = Boolean(argv.direct || false);
argv.time = Number(argv.time ?? 10); // stop after X seconds
argv.concur = Number(argv.concur ?? 1);
argv.forks = Number(argv.forks ?? 1);
argv.file_size = Number(argv.file_size ?? 64);
argv.block_size = Number(argv.block_size ?? 8);
argv.file_size_units = argv.file_size_units || 'MB';
argv.block_size_units = argv.block_size_units || 'MB';
argv.fsync = Boolean(argv.fsync ?? true); // true unless otherwise specified
argv.mode = argv.mode || 'nsfs';
argv.backend = argv.backend || 'GPFS';
if (argv.mode === 'dd') {
    argv.device = argv.device || '/dev/zero';
} else {
    // flags that are ignored on dd mode
    // nvec larger than 1 will use writev instead of write
    argv.nvec = argv.nvec || 1;
}
Object.freeze(argv);

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
const size_name = String(argv.file_size) + String(argv.file_size_units);
const block_count = Math.ceil(file_size / block_size);
const file_size_aligned = block_count * block_size;
const nb_native = argv.mode === 'nsfs' && require('../util/nb_native');

const fs_context = {
    backend: argv.backend,
    warn_threshold_ms: 10000,
};

const speedometer = new Speedometer({
    name: 'FS Speed',
    argv,
    num_workers: argv.forks,
    primary_init,
    workers_init,
    workers_func,
});
speedometer.start();

let _read_files = [];

async function primary_init() {
    if (!argv.write) {
        const dir = path.join(argv.path, size_name);
        console.log('Reading dir', dir, '(recursive) ...');
        const entries = await fs.promises.readdir(dir, { recursive: true, withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile()) {
                const file_path = path.join(entry.parentPath, entry.name);
                _read_files.push(file_path);
            }
        }
        console.log('Found', _read_files.length, 'files to read in dir', dir);
        return _read_files;
    }
}

async function workers_init(worker_id, worker_info) {
    if (!argv.write) {
        _read_files = worker_info;
        console.log('Workers got', _read_files.length, 'files to read');
    }
}

async function workers_func(worker_id, worker_info) {
    // nb_native().fs.set_debug_level(5);
    const promises = [];
    fs.mkdirSync(argv.path, { recursive: true });
    for (let i = 0; i < argv.concur; ++i) promises.push(io_worker(worker_id, i));
    await Promise.all(promises);
}

/**
 * @param {number} worker_id
 * @param {number} io_worker_id
 */
async function io_worker(worker_id, io_worker_id) {
    process.chdir(argv.path);
    const dir = path.join(
        // argv.path,
        size_name,
        `${worker_id || 1}`,
        `${io_worker_id}`,
    );
    await fs.promises.mkdir(dir, { recursive: true });
    const HASH_DIRS = 4;
    for (let i = 0; i < HASH_DIRS; ++i) {
        await fs.promises.mkdir(path.join(dir, String(i)), { recursive: true });
    }
    const worker_buf = Buffer.allocUnsafeSlow(block_size);

    const start_time = Date.now();
    const end_time = start_time + (argv.time * 1000);

    for (; ;) {
        const now = Date.now();
        if (now >= end_time) break;

        let file_path;
        const hash_dir = path.join(dir, String(now % HASH_DIRS));
        if (argv.write) {
            file_path = path.join(hash_dir, `file${size_name}-${now.toString(36)}`);
        } else {
            file_path = _read_files[crypto.randomInt(0, _read_files.length)];
        }

        try {
            await speedometer.measure(async () => {
                if (argv.mode === 'nsfs') {
                    return work_with_nsfs(file_path, worker_buf);
                } else if (argv.mode === 'nodejs') {
                    return work_with_nodejs(file_path, worker_buf);
                } else if (argv.mode === 'dd') {
                    return work_with_dd(file_path);
                }
            });
        } catch (err) {
            if (err.code === 'ENOENT') {
                if (argv.write) {
                    await fs.promises.mkdir(hash_dir, { recursive: true });
                } else {
                    console.warn('file not found', file_path);
                }
            } else {
                throw err;
            }
        }
    }
}

async function work_with_nsfs(file_path, buf) {
    const mode = (argv.write && 'w') || (argv.direct && 'rd') || 'r';
    const file = await nb_native().fs.open(fs_context, file_path, mode, 0o660);
    if (!argv.write) {
        const stat = await file.stat(fs_context);
        if (stat.size !== file_size_aligned) {
            throw new Error(`File size mismatch: expected ${file_size_aligned}, got ${stat.size}`);
        }
    }
    for (let pos = 0; pos < file_size_aligned; pos += buf.length) {
        if (argv.write) {
            await (argv.nvec > 1 ?
                file.writev(fs_context, split_to_nvec(buf, argv.nvec)) :
                file.write(fs_context, buf, buf.length, pos));
        } else {
            if (argv.nvec > 1) {
                throw new Error('TODO: readv is not yet available in NativeFile');
            }
            await file.read(fs_context, buf, 0, buf.length, pos);
        }
        speedometer.update(buf.length);
    }
    if (argv.write && argv.fsync) await file.fsync(fs_context);
    await file.close(fs_context);
}

async function work_with_nodejs(file_path, buf) {
    const file = await fs.promises.open(file_path, argv.write ? 'w' : 'r', 0o660);
    for (let pos = 0; pos < file_size_aligned; pos += buf.length) {
        if (argv.write) {
            await (argv.nvec > 1 ?
                file.writev(split_to_nvec(buf, argv.nvec)) :
                file.write(buf));
        } else {
            await (argv.nvec > 1 ?
                file.readv(split_to_nvec(buf, argv.nvec)) :
                file.read(buf));
        }
        speedometer.update(buf.length);
    }
    if (argv.write && argv.fsync) await file.sync();
    await file.close();
}

async function work_with_dd(file_path) {
    const cmd = argv.write ?
        `dd if=${argv.device} of=${file_path} bs=${block_size} count=${block_count}` :
        `dd if=${file_path} of=/dev/null bs=${block_size} count=${block_count}`;
    // console.log(cmd);
    await execAsync(cmd);
    if (argv.write && argv.fsync) await execAsync(`sync ${file_path}`);
    speedometer.update(file_size_aligned);
}

function split_to_nvec(buf, nvec) {
    const len = Math.ceil(buf.length / nvec);
    const bufs = [];
    for (let p = 0; p < buf.length; p += len) {
        bufs.push(buf.slice(p, p + len));
    }
    return bufs;
}
