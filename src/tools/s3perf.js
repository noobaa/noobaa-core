/* Copyright (C) 2016 NooBaa */
'use strict';

const minimist = require('minimist');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const nb_native = require('../util/nb_native');
const rdma_utils = require('../util/rdma_utils');
const RandStream = require('../util/rand_stream');
const Speedometer = require('../util/speedometer');
const { S3 } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const size_units_mult = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
};

const argv = minimist(process.argv.slice(2), {
    string: [
        'endpoint',
        'access_key',
        'secret_key',
        'bucket',
    ],
});

argv.time = Number(argv.time ?? 0);
argv.concur = Number(argv.concur || 1);
argv.forks = Number(argv.forks ?? 1);
argv.size = Number(argv.size ?? 1);
argv.size_units = argv.size_units || 'MB';
argv.part_concur = Number(argv.part_concur || 1);
argv.part_size = Number(argv.part_size || 5);
argv.verbose = Boolean(argv.verbose || argv.v);
argv.max_objects = Number(argv.max_objects ?? 1_000_000);
argv.select_objects ||= 'random';

const data_size = argv.size * size_units_mult[argv.size_units];
const size_name = String(argv.size) + String(argv.size_units);
argv.prefix ||= `s3perf/${size_name}/`;
argv.inventory ||= `s3perf/list-${size_name}`;

if (!size_units_mult[argv.size_units]) {
    throw new Error('Unrecognized size_units ' + argv.size_units);
}
if (argv.upload && data_size < argv.part_size * 1024 * 1024) {
    throw new Error('data_size lower than part_size ' + data_size);
}

/**
 * @typedef {{
 *      worker_id: number;
 *      io_worker_id: number;
 *      buffer?: Buffer;
 *      rdma_buf?: Buffer;
 *      cuda_mem?: nb.CudaMemory;
 *      rdma_client?: nb.CuObjClientNapi;
 *      s3_client?: S3;
 * }} IOWorker
 */

/** @typedef {import('@aws-sdk/client-s3')._Object} S3Object */

/** @type {string[]} */
let _object_keys;

/** @type {IOWorker[]} */
let _io_workers;

/**
 * @type {(io_worker: IOWorker) => Promise<number>}
 */
let op_func;
let need_object_keys = false;

if (argv.help || argv.h) {
    print_usage();
} else if (argv.get) {
    op_func = get_object;
    need_object_keys = true;
} else if (argv.put) {
    op_func = put_object;
} else if (argv.upload) {
    op_func = upload_object;
} else if (argv.head) {
    op_func = head_object;
    need_object_keys = true;
} else if (argv.delete) {
    op_func = delete_object;
    need_object_keys = true;
} else if (argv.gpu) {
    op_func = gpu_func;
    need_object_keys = true;
} else if (argv.mb) {
    op_func = create_bucket;
} else {
    print_usage();
}

// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;

/** @type {import('@aws-sdk/client-s3').S3ClientConfig} */
const s3_config = {
    endpoint: argv.endpoint,
    region: argv.region || 'us-east-1',
    forcePathStyle: true,
    credentials: {
        accessKeyId: argv.access_key && String(argv.access_key),
        secretAccessKey: argv.secret_key && String(argv.secret_key),
    },
    // disable checksums by default for performance
    // IMPORTANT - we had issues with applyChecksum - when migrating to sdkv3 check if works as expected.
    requestChecksumCalculation: argv.checksum ? 'WHEN_SUPPORTED' : 'WHEN_REQUIRED',
    responseChecksumValidation: argv.checksum ? 'WHEN_SUPPORTED' : 'WHEN_REQUIRED',
    userAgentAppId: 's3perf',
    requestHandler: {
        httpAgent: { keepAlive: true, rejectUnauthorized: !argv.selfsigned, localAddress: argv.local_ip, scheduling: 'fifo' },
        httpsAgent: { keepAlive: true, rejectUnauthorized: !argv.selfsigned, localAddress: argv.local_ip, scheduling: 'fifo' },
    }
};

const s3 = new S3(s3_config);

// AWS config does not use https.globalAgent
// so for https we need to set the agent manually
// if (is_https && !argv.selfsigned) {
//     // @ts-ignore
//     s3.middlewareStack.add().events.on('error', err => {
//         if (err.message === 'self signed certificate') {
//             setTimeout(() => console.log(
//                 '\n*** You can accept self signed certificates with: --selfsigned\n'
//             ), 10);
//         }
//     });
// }

const speedometer = new Speedometer({
    name: 'S3',
    argv,
    num_workers: argv.forks,
    primary_init,
    workers_init,
    workers_func,
});
speedometer.start();

async function primary_init() {
    if (need_object_keys) {
        let write_inventory = false;
        if (!_object_keys && argv.inventory) {
            try {
                _object_keys = await read_keys_from_inventory();
            } catch (err) {
                if (err.Code !== 'NoSuchKey') throw err;
                console.log('Inventory object not found, creating new one');
                write_inventory = true;
            }
        }
        if (!_object_keys) {
            _object_keys = [];
            console.log('Listing objects in bucket', argv.bucket, 'prefix', argv.prefix);
            await list_bucket_concurrent(argv.prefix, _object_keys, argv.max_objects);
        }
        if (!_object_keys?.length) {
            throw new Error(`No objects found for ${argv.prefix}`);
        }
        if (write_inventory) {
            console.log('Writing inventory', argv.inventory, 'with', _object_keys.length, 'objects');
            await s3.putObject({ Bucket: argv.bucket, Key: argv.inventory, Body: _object_keys.join('\n') });
        }
        console.log('Primary object keys', _object_keys.length);
    }
}

async function workers_init(worker_id) {
    if (need_object_keys) {
        if (!_object_keys && argv.inventory) {
            _object_keys = await read_keys_from_inventory();
        }
        if (!_object_keys?.length) {
            throw new Error(`No objects found for ${argv.prefix}`);
        }
        console.log('Worker object keys: ', _object_keys.length);
    }
    _io_workers = new Array(argv.concur).fill(0).map((v, i) =>
        init_io_worker({ worker_id, io_worker_id: i }));
}

async function workers_func() {
    await Promise.all(_io_workers.map(run_worker));
}

async function read_keys_from_inventory() {
    const text = await read_text_object(argv.inventory);
    const keys = text.split('\n').map(l => l.trim()).filter(l => l.length);
    return keys;
}

async function read_text_object(key) {
    const res = await s3.getObject({ Bucket: argv.bucket, Key: key });
    const body = await res.Body.transformToString();
    return body;
}

async function list_bucket_concurrent(prefix, list, max) {
    let is_truncated = true;
    let continuation_token;
    while (is_truncated) {
        if (list.length >= max) return;
        const res = await s3.listObjectsV2({
            Bucket: argv.bucket,
            Prefix: prefix,
            Delimiter: '/',
            MaxKeys: 1000,
            ContinuationToken: continuation_token,
        });
        if (list.length >= max) return;
        if (res.Contents) {
            for (const o of res.Contents) {
                list.push(o.Key);
                if (list.length >= max) return;
            }
        }
        await Promise.all(res.CommonPrefixes?.map(p => list_bucket_concurrent(p.Prefix, list, max)) || []);
        is_truncated = res.IsTruncated;
        continuation_token = res.NextContinuationToken;
    }
}

/**
 * @returns {string}
 */
function select_next_object_key() {
    if (argv.exact_key) return argv.exact_key;
    if (!need_object_keys || !_object_keys.length) throw new Error('No existing objects found');
    const i = crypto.randomInt(0, _object_keys.length);
    return _object_keys[i];
}

/**
 * @param {IOWorker} io_worker 
 * @returns {IOWorker}
 */
function init_io_worker(io_worker) {
    const buf_size = argv.rdma ? (data_size || 4096) : data_size;
    io_worker.buffer ||= nb_native().fs.dio_buffer_alloc(buf_size);
    io_worker.cuda_mem ||= argv.cuda ? new (nb_native().CudaMemory)(buf_size) : undefined;
    io_worker.rdma_buf ||= argv.cuda ? io_worker.cuda_mem.as_buffer() : io_worker.buffer;
    io_worker.rdma_client ||= argv.rdma ? rdma_utils.new_rdma_client() : undefined;
    io_worker.s3_client ||= argv.rdma ? rdma_utils.s3_rdma_client(s3_config, io_worker.rdma_buf, io_worker.rdma_client) : s3;
    return io_worker;
}

async function run_worker(io_worker) {
    try {
        const base_time = Date.now();
        for (; ;) {
            if (argv.time && Date.now() - base_time > argv.time * 1000) break;
            const start = process.hrtime.bigint();
            const size = await op_func(io_worker);
            const took_ms = Number(process.hrtime.bigint() - start) / 1e6;
            speedometer.update(size, took_ms);
        }
    } catch (err) {
        console.error('WORKER', process.pid, 'ERROR', err.stack || err);
        process.exit();
    }
}


/**
 * @param {IOWorker} io_worker 
 * @returns {Promise<number>}
 */
async function get_object(io_worker) {
    const key = select_next_object_key();
    /** @type {import('@aws-sdk/client-s3').GetObjectCommandOutput & { rdma_reply?: nb.RdmaReply }} */
    const res = await io_worker.s3_client.getObject({
        Bucket: argv.bucket,
        Key: key,
    });

    if (argv.verbose) console.log('GET', key, { ...res, Body: 'redacted' });

    // even on rdma we must consume the empty stream to release the connection

    /** @type {any} */
    const body = res.Body;
    for await (const chunk of body) {
        speedometer.update(chunk.length);
    }

    // const buf = await res.Body.transformToByteArray();
    // for await (const chunk of res.Body.transformToWebStream()) {
    //     speedometer.update(chunk.length);
    // }

    if (argv.rdma) {
        // @ts-ignore
        return res.rdma_reply?.num_bytes || 0;
    }
    return 0;
}

/**
 * @param {IOWorker} io_worker 
 * @returns {Promise<number>}
 */
async function put_object(io_worker) {
    const now = Date.now();
    const key = argv.exact_key || path.join(
        argv.prefix,
        process.env.CUDA_VISIBLE_DEVICES ? `GPU${process.env.CUDA_VISIBLE_DEVICES}` : '',
        `${io_worker.worker_id || 1}`,
        `${io_worker.io_worker_id}`,
        `${now % 4}`,
        `file${size_name}-${now.toString(36)}`);

    /** @type {import('@aws-sdk/client-s3').PutObjectCommandOutput & { rdma_reply?: nb.RdmaReply }} */
    const res = await io_worker.s3_client.putObject({
        Bucket: argv.bucket,
        Key: key,
        Body: argv.rdma ? null : io_worker.buffer,
        ContentLength: data_size,
        // Body: new RandStream(data_size, { highWaterMark: 1024 * 1024 }),
    });

    if (argv.verbose) console.log('PUT', key, res);

    if (argv.rdma) {
        // @ts-ignore
        return res.rdma_reply?.num_bytes || 0;
    }
    return data_size;
}

/**
 * @param {IOWorker} io_worker 
 * @returns {Promise<number>}
 */
async function upload_object(io_worker) {
    const now = Date.now();
    const key = argv.exact_key || path.join(
        argv.prefix,
        process.env.CUDA_VISIBLE_DEVICES ? `GPU${process.env.CUDA_VISIBLE_DEVICES}` : '',
        `${io_worker.worker_id || 1}`,
        `${io_worker.io_worker_id}`,
        `${now % 4}`,
        `file${size_name}-${now.toString(36)}`);

    const upload = new Upload({
        client: io_worker.s3_client,
        partSize: argv.part_size * 1024 * 1024,
        queueSize: argv.part_concur,
        params: {
            Bucket: argv.bucket,
            Key: key,
            ContentLength: data_size,
            Body: new RandStream(data_size, {
                highWaterMark: 1024 * 1024,
            })
        }
    });

    let last_loaded = 0;
    upload.on('httpUploadProgress', progress => {
        speedometer.update(progress.loaded - last_loaded);
        last_loaded = progress.loaded;
    });

    const res = await upload.done();
    if (argv.verbose) console.log('UPLOAD', key, res);

    return 0;
}

/**
 * gpu workflow
 * @param {IOWorker} io_worker 
 * @returns {Promise<number>}
 */
async function gpu_func(io_worker) {
    const key = select_next_object_key();
    /** @type {import('@aws-sdk/client-s3').GetObjectCommandOutput & { rdma_reply?: nb.RdmaReply }} */
    const get_res = await io_worker.s3_client.getObject({
        Bucket: argv.bucket,
        Key: key,
    });

    if (argv.verbose) console.log('GET', key, { ...get_res, Body: 'redacted' });

    let get_size = 0;

    if (argv.rdma) {
        // no need to make any copies!
        // but must consume the stream to release the http connection
        await get_res.Body.transformToString();
        // @ts-ignore
        get_size = get_res.rdma_reply?.num_bytes || 0;

    } else if (argv.cuda) {
        // copy the data to the cuda memory
        for await (const chunk of get_res.Body.transformToWebStream()) {
            get_size += io_worker.cuda_mem.copy_from_host(chunk, get_size);
        }

    } else {
        // copy the data to the buffer
        for await (const chunk of get_res.Body.transformToWebStream()) {
            get_size += chunk.copy(io_worker.buffer, get_size);
        }
    }

    if (argv.verbose) console.log('GET size', get_size);

    // modify
    if (argv.cuda) {
        io_worker.cuda_mem.fill(0xba);
    } else {
        io_worker.buffer.fill(0xba);
    }

    // copy the data back to the buffer
    if (argv.cuda && !argv.rdma) {
        io_worker.cuda_mem.copy_to_host(io_worker.buffer);
    }

    const put_key = argv.gpu + (argv.samekey ? '' : '-' + Date.now().toString(36));
    const put_res = await io_worker.s3_client.putObject({
        Bucket: argv.bucket,
        Key: put_key,
        Body: argv.rdma ? null : io_worker.buffer,
    });

    if (argv.verbose) console.log('PUT', put_key, put_res);

    // rdma transfered the object data directly from our rdma_buf[0..size]
    if (argv.rdma) {
        // @ts-ignore
        return put_res.rdma_reply?.num_bytes || 0;
    }

    return 0;
}

async function head_object() {
    const key = select_next_object_key();
    await s3.headObject({ Bucket: argv.bucket, Key: key });
    return 0;
}

async function delete_object() {
    // require an approval flag to prevent unintended deletes
    if (!argv.yes_really_delete) {
        console.error('Allow deleting objects with --yes_really_delete');
        process.exit(1);
    }
    const key = select_next_object_key();
    await s3.deleteObject({ Bucket: argv.bucket, Key: key });
    return 0;
}

async function create_bucket() {
    const new_bucket = argv.mb + '-' + Date.now().toString(36);
    await s3.createBucket({ Bucket: new_bucket });
    return 0;
}


function print_usage() {
    console.log(`
Usage:
  --help                show this usage
  --time <sec>          running time in seconds (0 seconds by default)
  --get                 get objects (prefix can be omitted)
  --put                 put (single part)
  --upload              upload (multipart)
  --gpu                 runs a gpu workflow
  --head                head objects
  --delete              delete objects
  --mb                  creates a new bucket
Upload Flags:
  --concur <num>        concurrent operations to run from each process (default is 1)
  --forks <num>         number of forked processes to run (default is 1)
  --size <num>          generate random data of size (default 1)
  --size_units KB|MB|GB generate random data of size_units (default MB)
  --part_size <MB>      multipart size
  --part_concur <num>   multipart concurrency
  --exact_key <key>     use this key for all operations
General S3 Flags:
  --endpoint <host>     (default is localhost)
  --access_key <key>    (default is env.AWS_ACCESS_KEY_ID || 123)
  --secret_key <key>    (default is env.AWS_SECRET_ACCESS_KEY || abc)
  --bucket <name>       (default is "first.bucket")
  --prefix <prefix>     (default is s3perf/<size><size_units>)
  --checksum            (default is false) Calculate checksums on data. slower.
  --verbose             (default is false) Print more info.
  --rdma                (default is false) Use RDMA for data transfer
  --cuda                (default is false) Use CUDA memory over RDMA
`);
    process.exit();
}
