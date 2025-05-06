/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');

const Speedometer = require('../../util/speedometer');
const RandStream = require('../../util/rand_stream');

// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;

if (argv.endpoint) {
    if (argv.endpoint === true) argv.endpoint = 'http://localhost';
    argv.access_key = argv.access_key || '123';
    argv.secret_key = argv.secret_key || 'abc';
}
argv.bucket = argv.bucket || 'first.bucket';
argv.dir = argv.dir || `capacity-test/${new Date().toISOString()}/`;
argv.part_size = (argv.part_size || 8) * 1024 * 1024;
argv.file_size = (argv.file_size || 128) * 1024 * 1024;
argv.concur = argv.concur || 16;
argv.count = argv.count || 1;
argv.workers = argv.workers || 1;

const s3 = new AWS.S3({
    endpoint: argv.endpoint,
    accessKeyId: argv.access_key,
    secretAccessKey: argv.secret_key,
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

const speedometer = new Speedometer({
    name: 'Capacity Upload Speed',
    argv,
    workers_func,
});
speedometer.start();

async function workers_func() {
    await Promise.all(Array(argv.workers).fill(0).map(() => worker()));
}

async function worker() {
    for (let i = 0; i < argv.count; ++i) {
        await speedometer.measure(upload_file);
    }
}

async function upload_file() {
    const key = `${argv.dir}capacity-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    console.log(ts(), 'upload start:', key, '...');
    const upload_params = {
        Bucket: argv.bucket,
        Key: key,
        Body: new RandStream(argv.file_size, {
            highWaterMark: argv.part_size,
        }),
        ContentType: 'application/octet-stream',
        ContentLength: argv.file_size,
    };
    const upload = argv.multipart ?
        s3.upload(upload_params, {
            partSize: argv.part_size,
            queueSize: argv.concur
        }) :
        s3.putObject(upload_params);

    let last_progress = 0;
    upload.on('httpUploadProgress', progress => {
        speedometer.update(progress.loaded - last_progress);
        last_progress = progress.loaded;
    });

    await upload.send();
    console.log(ts(), 'upload done.', key);

    // size already counted by httpUploadProgress event
    return 0;
}

function ts() {
    return new Date().toISOString();
}
