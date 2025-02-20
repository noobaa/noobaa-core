/* Copyright (C) 2016 NooBaa */
'use strict';

require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const minimist = require('minimist');
const http = require('http');
const https = require('https');
// const crypto = require('crypto');
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
        'head',
        'get',
        'put',
        'upload',
        'delete',
        'mb',
    ],
});

argv.time = argv.time || 0;
argv.concur = argv.concur || 1;
argv.forks = argv.forks || 1;
argv.size = argv.size || 1;
argv.size_units = argv.size_units || 'MB';
argv.part_concur = argv.part_concur || 1;
argv.part_size = argv.part_size || 5;
argv.verbose = Boolean(argv.verbose || argv.v);

const data_size = argv.size * size_units_mult[argv.size_units];

if (!size_units_mult[argv.size_units]) {
    throw new Error('Unrecognized size_units ' + argv.size_units);
}
if (argv.upload && data_size < argv.part_size * 1024 * 1024) {
    throw new Error('data_size lower than part_size ' + data_size);
}

/**
 * @typedef {{
 *      id: number;
 *      buffer?: Buffer;
 *      rdma_buf?: Buffer;
 *      cuda_mem?: nb.CudaMemory;
 *      rdma_client?: nb.RdmaClientNapi;
 *      s3_client?: S3;
 * }} Worker
 */

/**
 * @type {(worker: Worker) => Promise<number>}
 */
let op_func;

if (argv.help || argv.h) {
    print_usage();
} else if (typeof argv.mb === 'string') {
    op_func = create_bucket;
} else if (typeof argv.head === 'string') {
    op_func = head_object;
} else if (typeof argv.get === 'string') {
    op_func = get_object;
} else if (typeof argv.put === 'string') {
    op_func = put_object;
} else if (typeof argv.upload === 'string') {
    op_func = upload_object;
} else if (typeof argv.delete === 'string') {
    op_func = delete_object;
} else if (typeof argv.gmp === 'string') {
    op_func = gmp;
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
    requestChecksumCalculation: argv.checksum ? 'WHEN_SUPPORTED' : 'WHEN_REQUIRED',
    responseChecksumValidation: argv.checksum ? 'WHEN_SUPPORTED' : 'WHEN_REQUIRED',
    requestHandler: {
        httpAgent: { keepAlive: true, rejectUnauthorized: !argv.selfsigned, localAddress: argv.local_ip },
        httpsAgent: { keepAlive: true, rejectUnauthorized: !argv.selfsigned, localAddress: argv.local_ip },
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

const speedometer = new Speedometer('S3');
speedometer.run_workers(argv.forks, main, argv);

async function main() {
    if (argv.time) setTimeout(() => process.exit(), Number(argv.time) * 1000);
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(run_worker_loop, i);
    }
}

async function run_worker_loop(id) {
    try {
        const worker = { id };
        for (; ;) {
            const start = process.hrtime.bigint();
            const size = await op_func(worker);
            const took_ms = Number(process.hrtime.bigint() - start) / 1e6;
            speedometer.add_op(took_ms);
            if (size) speedometer.update(size);
        }
    } catch (err) {
        console.error('WORKER', process.pid, 'ERROR', err.stack || err);
        process.exit();
    }
}

/** @typedef {import('@aws-sdk/client-s3').ListObjectsCommandOutput} S3ListObjects */
/** @typedef {import('@aws-sdk/client-s3')._Object} S3Object */

/** @type {Promise<S3ListObjects>} */
let _list_objects_promise = null;
/** @type {S3ListObjects} */
let _list_objects = { Contents: [], IsTruncated: true, $metadata: {} };
let _list_objects_next = 0;

/**
 * This function returns the next object to be used for head/get/delete.
 * It will list objects and keep the list in memory, returning the objects in list order,
 * while fetching the next list pages on demand.
 * If prefix is provided it will be used to filter objects keys.
 * 
 * @param {string} [prefix]
 * @returns {Promise<S3Object>}
 */
async function get_next_object(prefix) {
    while (_list_objects_next >= _list_objects.Contents.length && _list_objects.IsTruncated) {
        if (_list_objects_promise) {
            // console.log('get_next_object: wait for promise');
            await _list_objects_promise;
        } else {
            const marker = _list_objects.IsTruncated ?
                (_list_objects.NextMarker || _list_objects.Contents[_list_objects.Contents.length - 1]?.Key) :
                undefined;
            _list_objects_promise = s3.listObjects({
                Bucket: argv.bucket,
                Prefix: prefix,
                Marker: marker,
            });
            const res = await _list_objects_promise;
            const prev = _list_objects;
            _list_objects = res;
            _list_objects.Contents = prev.Contents.concat(_list_objects.Contents);
            _list_objects_promise = null;
            console.log('get_next_object: got', _list_objects.Contents.length, 'objects from marker', marker);
        }
    }

    const obj = _list_objects.Contents[_list_objects_next];
    _list_objects_next += 1;
    _list_objects_next %= _list_objects.Contents.length;
    return obj;
}

async function create_bucket() {
    const new_bucket = argv.mb + '-' + Date.now().toString(36);
    await s3.createBucket({ Bucket: new_bucket });
    return 0;
}

async function delete_object() {
    const obj = await get_next_object(argv.delete);
    await s3.deleteObject({ Bucket: argv.bucket, Key: obj.Key });
    return 0;
}

async function head_object() {
    const obj = await get_next_object(argv.head);
    await s3.headObject({ Bucket: argv.bucket, Key: obj.Key });
    return 0;
}

/**
 * @param {Worker} worker 
 */
function init_io_worker(worker) {
    worker.buffer ||= nb_native().fs.dio_buffer_alloc(data_size);
    worker.cuda_mem ||= argv.cuda ? new (nb_native().CudaMemory)(data_size) : undefined;
    worker.rdma_buf ||= argv.cuda ? worker.cuda_mem.as_buffer() : worker.buffer;
    worker.s3_client ||= argv.rdma ? rdma_utils.s3_rdma_client(s3_config, worker.rdma_buf) : s3;
}

/**
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function get_object(worker) {
    init_io_worker(worker);

    const get_key = argv.samekey ? argv.get : ((await get_next_object(argv.get)).Key);
    const get_res = await worker.s3_client.getObject({
        Bucket: argv.bucket,
        Key: get_key,
    });

    if (argv.verbose) console.log('GET', get_key, { ...get_res, Body: 'redacted' });

    // must consume the stream to release the connection
    for await (const chunk of get_res.Body.transformToWebStream()) {
        speedometer.update(chunk.length);
    }

    if (argv.rdma) {
        // @ts-ignore
        return get_res.rdma_reply.size;
    }
    return 0;
}

/**
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function put_object(worker) {
    init_io_worker(worker);

    const put_key = argv.put + (argv.samekey ? '' : '-' + Date.now().toString(36));
    const put_res = await worker.s3_client.putObject({
        Bucket: argv.bucket,
        Key: put_key,
        Body: argv.rdma ? null : worker.buffer,
        ContentLength: data_size,
        // Body: new RandStream(data_size, { highWaterMark: 1024 * 1024 }),
    });

    if (argv.verbose) console.log('PUT', put_key, put_res);

    if (argv.rdma) {
        // @ts-ignore
        return put_res.rdma_reply.size;
    }
    return data_size;
}

/**
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function upload_object(worker) {
    init_io_worker(worker);

    const upload_key = argv.upload + (argv.samekey ? '' : '-' + Date.now().toString(36));
    const upload = new Upload({
        client: worker.s3_client,
        partSize: argv.part_size * 1024 * 1024,
        queueSize: argv.part_concur,
        params: {
            Bucket: argv.bucket,
            Key: upload_key,
            ContentLength: data_size,
            Body: new RandStream(data_size, {
                highWaterMark: 1024 * 1024,
            })
        }
    });

    upload.on('httpUploadProgress', progress => {
        speedometer.update(progress.loaded);
    });

    const upload_res = await upload.done();
    if (argv.verbose) console.log('UPLOAD', upload_key, upload_res);

    return 0;
}

/**
 * get-modify-put workflow
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function gmp(worker) {
    init_io_worker(worker);

    const get_key = argv.samekey ? argv.gmp : ((await get_next_object(argv.gmp)).Key);
    const get_res = await worker.s3_client.getObject({
        Bucket: argv.bucket,
        Key: get_key,
    });

    if (argv.verbose) console.log('GET', get_key, { ...get_res, Body: 'redacted' });

    let get_size = 0;

    if (argv.rdma) {
        // no need to make any copies!
        // but must consume the stream to release the http connection
        await get_res.Body.transformToString();
        // @ts-ignore
        get_size = get_res.rdma_reply.size;

    } else if (argv.cuda) {
        // copy the data to the cuda memory
        for await (const chunk of get_res.Body.transformToWebStream()) {
            get_size += worker.cuda_mem.copy_from_host(chunk, get_size);
        }

    } else {
        // copy the data to the buffer
        for await (const chunk of get_res.Body.transformToWebStream()) {
            get_size += chunk.copy(worker.buffer, get_size);
        }
    }

    // modify
    if (argv.cuda) {
        worker.cuda_mem.fill(0xba);
    } else {
        worker.buffer.fill(0xba);
    }

    // copy the data back to the buffer
    if (argv.cuda && !argv.rdma) {
        worker.cuda_mem.copy_to_host(worker.buffer);
    }

    const put_key = argv.gmp + (argv.samekey ? '' : '-' + Date.now().toString(36));
    const put_res = await worker.s3_client.putObject({
        Bucket: argv.bucket,
        Key: put_key,
        Body: argv.rdma ? null : worker.buffer,
    });

    if (argv.verbose) console.log('PUT', put_key, put_res);

    // rdma transfered the object data directly from our rdma_buf[0..size]
    if (argv.rdma) {
        // @ts-ignore
        return put_res.rdma_reply.size;
    }

    return 0;
}


function print_usage() {
    console.log(`
Usage:
  --help                 show this usage
  --time <sec>           running time in seconds (0 seconds by default)
  --mb <bucket>          creates a new bucket (bucket can be omitted)
  --head <prefix>        head objects (prefix can be omitted)
  --get <prefix>         get objects (prefix can be omitted)
  --delete <prefix>      delete objects (prefix can be omitted)
  --put <key>            put (single) to key (key can be omitted)
  --upload <key>         upload (multipart) to key (key can be omitted)
  --gmp <key>            runs a get-modify-put workflow (key can be omitted)
Upload Flags:
  --concur <num>         concurrent operations to run from each process (default is 1)
  --forks <num>          number of forked processes to run (default is 1)
  --size <num>           generate random data of size (default 1)
  --size_units KB|MB|GB  generate random data of size_units (default MB)
  --part_size <MB>       multipart size
  --part_concur <num>    multipart concurrency
  --samekey              use the same key for all operations
General S3 Flags:
  --endpoint <host>      (default is localhost)
  --access_key <key>     (default is env.AWS_ACCESS_KEY_ID || 123)
  --secret_key <key>     (default is env.AWS_SECRET_ACCESS_KEY || abc)
  --bucket <name>        (default is "first.bucket")
  --checksum             (default is false) Calculate checksums on data. slower.
  --verbose              (default is false) Print more info.
  --rdma                 (default is false) Use RDMA for data transfer
  --cuda                 (default is false) Use CUDA memory over RDMA
`);
    process.exit();
}
