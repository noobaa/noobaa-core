/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const size_utils = require('../util/size_utils');
const RandStream = require('../util/rand_stream');
const { cluster } = require('../util/fork_utils');

const size_units_mult = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
};

argv.sig = argv.sig || 's3';
argv.time = argv.time || 0;
argv.concur = argv.concur || 1;
argv.forks = argv.forks || 1;
argv.size = argv.size || 1;
argv.size_units = argv.size_units || 'MB';
argv.part_concur = argv.part_concur || 1;
argv.part_size = argv.part_size || 5;

const data_size = argv.size * size_units_mult[argv.size_units];

if (!size_units_mult[argv.size_units]) {
    throw new Error('Unrecognized size_units ' + argv.size_units);
}
if (argv.upload && data_size < argv.part_size * 1024 * 1024) {
    throw new Error('data_size lower than part_size ' + data_size);
}

const start_time = Date.now();

let op_lat_sum = 0;
let op_count = 0;
let op_size = 0;
let last_reported = start_time;
let last_op_count = 0;
let last_op_lat_sum = 0;

let op_func;

if (argv.help) {
    print_usage();
} else if (argv.head) {
    op_func = head_object;
    op_size = 0;
} else if (argv.get) {
    op_func = get_object;
    op_size = data_size;
} else if (argv.put) {
    op_func = put_object;
    op_size = data_size;
} else if (argv.upload) {
    op_func = upload_object;
    op_size = data_size;
} else if (argv.delete) {
    op_func = delete_all_objects;
} else if (argv.mb) {
    op_func = create_bucket;
    op_size = 0;
} else {
    print_usage();
}

// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;

const s3 = new AWS.S3({
    endpoint: argv.endpoint,
    accessKeyId: argv.access_key && String(argv.access_key),
    secretAccessKey: argv.secret_key && String(argv.secret_key),
    s3ForcePathStyle: true,
    signatureVersion: argv.sig, // s3 or v4
    computeChecksums: argv.checksum || false, // disabled by default for performance
    s3DisableBodySigning: !argv.signing || true, // disabled by default for performance
    region: argv.region || 'us-east-1',
});

// AWS config does not use https.globalAgent
// so for https we need to set the agent manually
if (s3.endpoint.protocol === 'https:') {
    s3.config.update({
        httpOptions: {
            agent: new https.Agent({
                keepAlive: true,
                rejectUnauthorized: !argv.selfsigned,
            })
        }
    });
    if (!argv.selfsigned) {
        // @ts-ignore
        AWS.events.on('error', err => {
            if (err.message === 'self signed certificate') {
                setTimeout(() => console.log(
                    '\n*** You can accept self signed certificates with: --selfsigned\n'
                ), 10);
            }
        });
    }
}

if (cluster.isPrimary) {
    run_master();
} else {
    run_worker();
}

async function run_master() {
    if (argv.forks > 1) {
        for (let i = 0; i < argv.forks; i++) {
            const worker = cluster.fork();
            console.warn('WORKER', worker.process.pid, 'STARTED');
            worker.on('message', handle_message);
        }
        cluster.on('exit', (worker, code, signal) => {
            console.warn('WORKER', worker.process.pid, 'EXITED', code, signal);
            exit_all();
        });
    } else {
        run_worker();
    }

    setInterval(run_reporter, 1000).unref();
}

function run_reporter() {

    const now = Date.now();
    const time = now - last_reported;
    const time_total = now - start_time;
    const ops = op_count - last_op_count;
    const lat = op_lat_sum - last_op_lat_sum;
    const tx = ops * op_size / time * 1000;
    const tx_total = op_count * op_size / time_total * 1000;

    console.log(`TOTAL: Throughput ${
        size_utils.human_size(tx_total)
        }/sec Latency ${
        op_count ? (op_lat_sum / op_count).toFixed(3) : 0
        }ms IOPS ${
        (op_count / time_total * 1000).toFixed(3)
        }/sec OPS ${op_count} | CURRENT: Throughput ${
        size_utils.human_size(tx)
        }/sec Latency ${
        ops ? (lat / ops).toFixed(3) : 0
        }ms IOPS ${
        (ops / time * 1000).toFixed(3)
        }/sec OPS ${ops}`);

    last_reported = now;
    last_op_count = op_count;
    last_op_lat_sum = op_lat_sum;

    if (now - start_time > argv.time * 1000) {
        console.warn('TEST DONE');
        exit_all();
    }
}

function exit_all() {
    Object.keys(cluster.workers).forEach(w => cluster.workers[w].send('exit'));
    process.exit();
}

function handle_message(msg) {
    if (msg === 'exit') {
        process.exit();
    } else if (msg.took_ms >= 0) {
        op_lat_sum += msg.took_ms;
        op_count += 1;
    }
}

async function run_worker() {
    if (process.send) process.on('message', handle_message);
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(run_worker_loop);
    }
}

async function run_worker_loop() {
    try {
        for (;;) {
            const hrtime = process.hrtime();
            await op_func();
            const hrtook = process.hrtime(hrtime);
            const took_ms = (hrtook[0] * 1e-3) + (hrtook[1] * 1e-6);
            if (process.send) {
                process.send({ took_ms });
            } else {
                handle_message({ took_ms });
            }
        }
    } catch (err) {
        console.error('WORKER', process.pid, 'ERROR', err.stack || err);
        process.exit();
    }
}

const _object_keys = [];
let _object_keys_next = 0;
let _object_keys_done = false;
let _object_keys_promise = null;

/**
 * This function returns the next key to be used for head/get/delete.
 * It has few modes depending on the value of the --head/--get/--delete arg (provided as `key_arg`):
 * If key_arg is provided as a string that does not end with '/' it is assumed to be a fixed key to be used for all calls.
 * Otherwise, it will list objects and keep the list in memory, returning the objects in list order,
 * while fetching the next list pages on demand.
 * If key_arg ends with '/' it will be used as a prefix for the list objects request to filter objects.
 * 
 * @param {string} key_arg 
 * @returns string
 */
async function get_object_key(key_arg) {
    if (typeof key_arg === 'string' && !key_arg.endsWith('/')) {
        return key_arg;
    }

    while (_object_keys_next >= _object_keys.length) {
        if (_object_keys_done) {
            if (!_object_keys_next) throw new Error('no objects');
            _object_keys_next = 0;
            console.log('get_object_key: Restart object list with', _object_keys.length, 'items');
        } else if (_object_keys_promise) {
            console.log('get_object_key: wait for promise');
            await _object_keys_promise;
        } else {
            const marker = _object_keys[_object_keys.length - 1];
            const prefix = typeof key_arg === 'string' ? String(key_arg) : undefined;
            _object_keys_promise = s3.listObjects({ Bucket: argv.bucket, Prefix: prefix, Marker: marker }).promise();
            const res = await _object_keys_promise;
            _object_keys_promise = null;
            _object_keys_done = !res.IsTruncated;
            _object_keys.push(...res.Contents.map(entry => entry.Key));
            console.log('get_object_key: got', res.Contents.length, 'objects from marker', marker);
        }
    }

    const key = _object_keys[_object_keys_next];
    _object_keys_next += 1;
    return key;
}

async function head_object() {
    const key = await get_object_key(argv.head);
    // console.log('HEAD', key);
    return s3.headObject({ Bucket: argv.bucket, Key: key }).promise();
}

async function get_object() {
    const key = await get_object_key(argv.get);
    return new Promise((resolve, reject) => {
        s3.getObject({
                Bucket: argv.bucket,
                Key: key,
                Range: `bytes=0-${data_size}`
            })
            .createReadStream()
            .on('finish', resolve)
            .on('error', reject)
            .on('data', data => {
                // noop
            });
    });
}

async function delete_all_objects() {
    const key = await get_object_key(argv.delete);
    await s3.deleteObject({
        Bucket: argv.bucket,
        Key: key
    }).promise();
}

async function put_object() {
    const upload_key = argv.put + '-' + Date.now().toString(36);
    return s3.putObject({
            Bucket: argv.bucket,
            Key: upload_key,
            ContentLength: data_size,
            Body: new RandStream(data_size, {
                highWaterMark: 1024 * 1024,
            })
        })
        .promise();
}

async function upload_object() {
    const upload_key = argv.upload + '-' + Date.now().toString(36);
    return s3.upload({
            Bucket: argv.bucket,
            Key: upload_key,
            ContentLength: data_size,
            Body: new RandStream(data_size, {
                highWaterMark: 1024 * 1024,
            })
        }, {
            partSize: argv.part_size * 1024 * 1024,
            queueSize: argv.part_concur
        })
        .promise();
}

async function create_bucket() {
    const new_bucket = argv.mb + '-' + Date.now().toString(36);
    return s3.createBucket({ Bucket: new_bucket }).promise();
}

function print_usage() {
    console.log(`
Usage:
  --help                 show this usage
  --time <sec>           running time in seconds (0 seconds by default)
  --head <key>           head key name
  --get <key>            get key name (key can be omitted)
  --put <key>            put (single) to key (key can be omitted)
  --upload <key>         upload (multipart) to key (key can be omitted)
  --mb <bucket>          creates a new bucket (bucket can be omitted)
  --delete               iterates and delete all objects in the bucket (passed by --bucket or default)
Upload Flags:
  --concur <num>         concurrent operations to run from each process (default is 1)
  --forks <num>          number of forked processes to run (default is 1)
  --size <num>           generate random data of size (default 1)
  --size_units KB|MB|GB  generate random data of size_units (default MB)
  --part_size <MB>       multipart size
  --part_concur <num>    multipart concurrency
General S3 Flags:
  --endpoint <host>      (default is localhost)
  --access_key <key>     (default is env.AWS_ACCESS_KEY_ID || 123)
  --secret_key <key>     (default is env.AWS_SECRET_ACCESS_KEY || abc)
  --bucket <name>        (default is "first.bucket")
  --sig v4|s3            (default is s3)
  --ssl                  (default is false) Force SSL connection
  --aws                  (default is false) Use AWS endpoint and subdomain-style buckets
  --checksum             (default is false) Calculate checksums on data. slower.
`);
    process.exit();
}
