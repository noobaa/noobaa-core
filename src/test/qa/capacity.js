/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');

const P = require('../../util/promise');
const Speedometer = require('../../util/speedometer');
const RandStream = require('../../util/rand_stream');

http.globalAgent.keepAlive = true;
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

const speedometer = new Speedometer('Capacity Upload Speed');
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

function upload_file() {
    const key = `${argv.dir}capacity-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    console.log(ts(), 'upload start:', key, '...');
    let last_progress = 0;
    const upload_params = {
        Key: key,
        Body: new RandStream(argv.file_size, {
            highWaterMark: argv.part_size,
        }),
        ContentType: 'application/octet-stream',
        ContentLength: argv.file_size
    };
    const upload = argv.multipart ?
        s3.upload(upload_params, {
            partSize: argv.part_size,
            queueSize: argv.concur
        }) :
        s3.putObject(upload_params);
    upload.on('httpUploadProgress', progress => {
        speedometer.update(progress.loaded - last_progress);
        last_progress = progress.loaded;
    });
    return P.fromCallback(callback => upload.send(callback))
        .then(() => console.log(ts(), 'upload done.', key))
        .catch(err => {
            console.error(ts(), 'UPLOAD ERROR', err);
            return P.delay(1000);
        });
}

function main() {
    P.all(_.times(argv.workers, function worker() {
            if (argv.count <= 0) return;
            argv.count -= 1;
            return upload_file().then(worker);
        }))
        .then(() => speedometer.report());
}

function ts() {
    return new Date().toISOString();
}

if (require.main === module) {
    main();
}
