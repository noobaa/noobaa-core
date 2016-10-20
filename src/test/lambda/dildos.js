/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const http = require('http');
const argv = require('minimist')(process.argv);

const P = require('../../util/promise');
const lambda_utils = require('../../lambda/lambda_utils');

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
        .then(() => P.each(_.times(1000), run_denial_of_service));
        // .then(() => run_denial_of_service());
}

function create_func(fn) {
    const name = fn.name;
    const code = `exports.handler = ${fn};`;
    const files = {};
    files[name + '.js'] = new Buffer(code);
    return lambda_utils.zip_in_memory(files)
        .then(zip => P.fromCallback(callback => lambda.createFunction({
            FunctionName: name, // required
            Runtime: 'nodejs4.3', // required
            Handler: name + '.handler', // required
            Role: 'arn:aws:iam::638243541865:role/lambda-test', // required
            Code: { // required
                ZipFile: zip
            },
            // Publish: true,
            // MemorySize: 0,
            // Timeout: 0,
            // Description: '',
        }, callback)));
}

function run_denial_of_service() {
    return P.resolve()
        .then(() => P.fromCallback(callback => lambda.invoke({
            FunctionName: dildos_denial_func.name,
            // Payload: JSON.stringify({}),
        }, callback)))
        .then(res => console.log('Result from dildos_denial_func:', res))
        .then(() => P.fromCallback(callback => lambda.invoke({
            FunctionName: dildos_service_func.name,
            // Payload: JSON.stringify({}),
        }, callback)))
        .then(res => console.log('Result from dildos_service_func:', res));
}

function dildos_denial_func(event, context, callback) {
    callback(null, '<<<DENIAL>>>');
}

function dildos_service_func(event, context, callback) {
    callback(null, '<<<SERVICE>>>');
}

main();
