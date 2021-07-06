/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const cluster = require('cluster');
const size_utils = require('../util/size_utils');
const RandStream = require('../util/rand_stream');

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

var op_lat_sum = 0;
var op_count = 0;
var op_size = 0;
var last_reported = start_time;
var last_op_count = 0;
var last_op_lat_sum = 0;

var op_func;

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

if (argv.endpoint) {
    if (argv.endpoint === true) argv.endpoint = 'http://localhost';
    argv.access_key = argv.access_key || '123';
    argv.secret_key = argv.secret_key || 'abc';
    argv.bucket = argv.bucket || 'first.bucket';
}

http.globalAgent.keepAlive = true;
https.globalAgent.keepAlive = true;

const s3 = new AWS.S3({
    endpoint: argv.endpoint,
    accessKeyId: argv.access_key,
    secretAccessKey: argv.secret_key,
    s3ForcePathStyle: true,
    signatureVersion: argv.sig, // s3 or v4
    computeChecksums: argv.checksum || false, // disabled by default for performance
    s3DisableBodySigning: !argv.signing || true, // disabled by default for performance
    region: argv.region || 'us-east-1',
    params: {
        Bucket: argv.bucket
    },
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
        AWS.events.on('error', err => {
            if (err.message === 'self signed certificate') {
                setTimeout(() => console.log(
                    '\n*** You can accept self signed certificates with: --selfsigned\n'
                ), 10);
            }
        });
    }
}

if (cluster.isMaster) {
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
    process.on('message', handle_message);
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

async function head_object() {
    return s3.headObject({ Key: argv.head }).promise();
}


let objects = [];
let index = 0;
async function get_object_key() {
    if (typeof argv.get === 'string') {
        return argv.get;
    } else {
        if (index === objects.length) {
            const marker = objects[objects.length - 1];
            let objlist = await s3.listObjects({ Marker: marker }).promise();
            objects = objlist.Contents.map(entry => entry.Key);
            index = 0;
        }

        let key = objects[index];
        index += 1;
        return key;
    }
}

async function get_object() {
    const key = await get_object_key();
    return new Promise((resolve, reject) => {
        s3.getObject({
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
    const key = await get_object_key();
    await s3.deleteObject({
        Key: key
    }).promise();
}

async function put_object() {
    const upload_key = argv.put + '-' + Date.now().toString(36);
    return s3.putObject({
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
