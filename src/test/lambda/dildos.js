/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const AWS = require('aws-sdk');
const http = require('http');
const path = require('path');
const argv = require('minimist')(process.argv);

const P = require('../../util/promise');
const zip_utils = require('../../util/zip_utils');

const lambda = new AWS.Lambda({
    region: argv.region || 'us-east-1',
    endpoint: argv.aws ? undefined : (argv.endpoint || 'http://127.0.0.1:6001'),
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

const ROLE_ARN = 'arn:aws:iam::638243541865:role/lambda-test';

const word_count_func = {
    FunctionName: 'word_count_func',
    Description: 'Word Count of a web page',
    Runtime: 'nodejs6',
    Handler: 'word_count_func.handler',
    Role: ROLE_ARN,
    VpcConfig: {
        SubnetIds: argv.pools ? argv.pools.split(',') : []
    },
    Files: ['word_count_func.js']
};

const dos_func = {
    FunctionName: 'dos_func',
    Description: 'Denial of Service',
    Runtime: 'nodejs6',
    Handler: 'denial_of_service_func.handler',
    Role: ROLE_ARN,
    VpcConfig: {
        SubnetIds: argv.pools ? argv.pools.split(',') : []
    },
    Files: ['denial_of_service_func.js']
};


function main() {
    if (argv.show) return show();
    if (argv.install) return install();
    if (argv.test) return test();
    if (argv.dildos) return dildos();
    console.log('Usage: --show|--install|--test|--dildos');
}

function show() {
    return P.fromCallback(callback => lambda.listFunctions({}, callback))
        .then(res => {
            _.each(res.Functions, f => {
                console.log(`${f.FunctionName}`);
                console.log(`\tPools        : ${f.VpcConfig.SubnetIds}`);
                console.log(`\tVersion      : ${f.Version}`);
                console.log(`\tLastModified : ${f.LastModified}`);
                console.log(`\tCodeSha256   : ${f.CodeSha256}`);
                console.log(`\tCodeSize     : ${f.CodeSize}`);
                console.log(`\t`);
            });
        });
}

function install() {
    if (argv.install === 'wc') {
        return install_func(word_count_func);
    }
    if (argv.install === 'dos') {
        return install_func(dos_func);
    }
    return P.resolve()
        .then(() => install_func(word_count_func))
        .then(() => install_func(dos_func));
}

function install_func(fn) {
    console.log('Creating Function:', fn);
    return P.resolve()
        .then(() => prepare_func(fn))
        .then(() => P.fromCallback(callback => lambda.deleteFunction({
                FunctionName: fn.FunctionName,
            }, callback))
            .catch(err => {
                console.log('Delete function if exist:', err.message);
            }))
        .then(() => P.fromCallback(callback => lambda.createFunction(fn, callback)))
        .then(() => console.log('created.'));
}

function prepare_func(fn) {
    return P.resolve()
        .then(() => P.map(fn.Files, f => fs.readFileAsync(path.join(__dirname, f))))
        .then(files_data => _.zipObject(fn.Files, files_data))
        .then(files_map => zip_utils.zip_in_memory(files_map))
        .then(zipfile => {
            delete fn.Files;
            fn.Code = {
                ZipFile: zipfile
            };
        });
}

function test() {
    const wc_event = {
        url: argv.url || 'http://127.0.0.1:5001',
        return_text: argv.return_text,
    };
    const params = argv.test === 'dos' ? {
        FunctionName: dos_func.FunctionName,
        Payload: JSON.stringify({
            func_name: word_count_func.FunctionName,
            func_event: wc_event,
            time: 1000,
            concur: 1,
        }),
    } : {
        FunctionName: word_count_func.FunctionName,
        Payload: JSON.stringify(wc_event)
    };
    console.log('Testing', params);
    return P.fromCallback(callback => lambda.invoke(params, callback))
        .then(res => console.log('Result:', res));
}

function dildos() {
    const concur = Number(argv.dildos) || 1;
    const timeout = argv.timeout || 10000;
    const start = Date.now();
    const end = start + timeout;
    let total_calls = 0;
    let total_errors = 0;
    let total_took = 0;
    let last_report = 0;
    let last_calls = 0;
    let last_took = 0;
    console.log(`Starting ${concur} DILDOS`);

    const invoke_params = {
        FunctionName: dos_func.FunctionName,
        Payload: JSON.stringify({
            func_name: word_count_func.FunctionName,
            func_event: {
                random: 1024,
            },
            time: 1000,
            concur: 1,
        }),
    };

    function worker() {
        const now = Date.now();
        if (now >= end) return;
        return P.fromCallback(callback => lambda.invoke(invoke_params, callback))
            .then(res => {
                if (argv.debug) {
                    console.log('Result:', res, 'from', invoke_params);
                }
                const reply = res.Response || JSON.parse(res.Payload);
                total_calls += reply.num_calls;
                total_errors += reply.num_errors;
                total_took += reply.took;
                const now_report = Date.now();
                if (now_report - last_report >= 1000) {
                    report({
                        title: 'Report',
                        calls: total_calls - last_calls,
                        took: total_took - last_took,
                        time: now_report - last_report,
                    });
                    last_report = now_report;
                    last_calls = total_calls;
                    last_took = total_took;
                }
            })
            .then(worker);
    }

    function report(params) {
        const calls_per_sec = (params.calls * 1000 / params.time).toFixed(3);
        const avg_latency = (params.took / params.calls).toFixed(3);
        console.log(`${params.title}: Latency ${avg_latency}ms | Calls per second ${calls_per_sec} | Calls ${params.calls} | Errors ${total_errors}`);
    }

    return P.map(_.times(concur), worker)
        .then(() => {
            const now = Date.now();
            report({
                title: 'Final',
                calls: total_calls,
                took: total_took,
                time: now - start,
            });
            console.log(`Done.`);
        });
}


main();
