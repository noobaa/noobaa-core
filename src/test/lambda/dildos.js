/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const http = require('http');
const argv = require('minimist')(process.argv);

const P = require('../../util/promise');
const zip_utils = require('../../util/zip_utils');

const lambda = new AWS.Lambda({
    region: argv.region || 'us-east-1',
    endpoint: argv.aws ? undefined : (argv.endpoint || 'http://127.0.0.1:6002'),
    accessKeyId: argv.access_key || process.env.AWS_ACCESS_KEY_ID || '123',
    secretAccessKey: argv.secret_key || process.env.AWS_SECRET_ACCESS_KEY || 'abc',
    signatureVersion: argv.sigver || 'v4', // use s3/v4, v2 seems irrelevant
    sslEnabled: argv.ssl || false,
    computeChecksums: argv.checksum || false,
    s3ForcePathStyle: !argv.aws,
    httpOptions: {
        agent: new http.Agent({
            keepAlive: true
        })
    }
});

function main() {
    return P.resolve()
        .then(() => create_func(dildos_denial_func))
        .then(() => create_func(dildos_service_func))
        .then(() => run_denial_of_service());
}

function create_func(fn) {
    const name = fn.name;
    const code = `exports.handler = ${fn};`;
    const files = {};
    files[name + '.js'] = new Buffer(code);
    console.log('Creating Function:', name);
    return P.fromCallback(callback => lambda.deleteFunction({
            FunctionName: name,
        }, callback))
        .catch(err => {
            // ignore errors
        })
        .then(() => zip_utils.zip_in_memory(files))
        .then(zip => P.fromCallback(callback => lambda.createFunction({
            FunctionName: name, // required
            Runtime: 'nodejs6', // required
            Handler: name + '.handler', // required
            Role: 'arn:aws:iam::638243541865:role/lambda-test', // required
            Code: { // required
                ZipFile: zip
            },
            // Publish: true,
            // MemorySize: 0,
            // Timeout: 0,
            // Description: '',
        }, callback)))
        .then(() => console.log('created.'));
}

function run_denial_of_service() {
    const state = {
        start: Date.now(),
        index: 0,
        count: 1024,
        concur: 128,
        num_bytes: 0,
    };
    console.log('DILDOS Starting:', state);

    function denial_worker() {
        state.index += 1;
        if (state.index > state.count) return;
        return P.fromCallback(callback =>
                lambda.invoke({
                    FunctionName: dildos_denial_func.name,
                    // FunctionName: dildos_service_func.name,
                    Payload: JSON.stringify({
                        index: state.index,
                        hash_type: 'sha256',
                        num_bytes: state.num_bytes,
                        encoding: 'hex',
                    }),
                }, callback))
            .then(res => console.log('Result from dildos_denial_func:', res))
            .then(denial_worker);
    }

    return P.map(_.times(state.concur), denial_worker)
        .then(() => {
            const took = Date.now() - state.start;
            console.log('Done.');
            console.log('Total time         :',
                (took / 1000).toFixed(3), 'sec');
            console.log('Latency (average)  :',
                (took / state.count).toFixed(3), 'ms');
            console.log('Calls per second   :',
                (state.count * 1000 / took).toFixed(3));
            console.log('Throughput (sha256):',
                (state.count * state.num_bytes * 1000 / took / 1024 / 1024).toFixed(3),
                'MB/sec');
        });
}

function dildos_denial_func(event, context, callback) {
    context.invoke_lambda('dildos_service_func', event, callback);
}

function dildos_service_func(event, context, callback) {
    const crypto = require('crypto');
    const hasher = crypto.createHash(event.hash_type);
    if (event.num_bytes) {
        // fast random bytes by encrypting zeros with random key/iv
        const cipher = crypto.createCipheriv('aes-128-gcm',
            crypto.randomBytes(16), crypto.randomBytes(12));
        const zero_buffer = Buffer.alloc(16 * 1024);
        var pos = 0;
        while (pos + zero_buffer.length <= event.num_bytes) {
            hasher.update(cipher.update(zero_buffer));
            pos += zero_buffer.length;
        }
        if (pos < event.num_bytes) {
            hasher.update(cipher.update(zero_buffer.slice(0, event.num_bytes - pos)));
        }
    }
    event.hash = hasher.digest(event.encoding);
    callback(null, event);
}

main();
