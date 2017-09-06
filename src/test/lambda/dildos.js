/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
// const http = require('http');
const path = require('path');
const argv = require('minimist')(process.argv);

const P = require('../../util/promise');
const config = require('../../../config.js');
const zip_utils = require('../../util/zip_utils');

const LAMBDA_CONF = {
    region: argv.region || 'us-east-1',
    endpoint: argv.aws ? undefined : (argv.endpoint || 'http://127.0.0.1:6001'),
    accessKeyId: argv.access_key || process.env.AWS_ACCESS_KEY_ID || '123',
    secretAccessKey: argv.secret_key || process.env.AWS_SECRET_ACCESS_KEY || 'abc',
    sslEnabled: argv.ssl || false,
};

const lambda = new AWS.Lambda(LAMBDA_CONF);

const ROLE_ARN = 'arn:aws:iam::112233445566:role/lambda-test';
const POOLS = argv.pools ? argv.pools.split(',') : [config.NEW_SYSTEM_POOL_NAME];

const word_count_func = {
    FunctionName: 'word_count_func',
    Description: 'Word Count of a web page',
    Runtime: 'nodejs6',
    Handler: 'word_count_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'word_count_func.js',
        fs_path: path.join(__dirname, 'word_count_func.js'),
    }]
};

const dos_func = {
    FunctionName: 'dos_func',
    Description: 'Denial of Service',
    Runtime: 'nodejs6',
    Handler: 'denial_of_service_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'denial_of_service_func.js',
        fs_path: path.join(__dirname, 'denial_of_service_func.js'),
    }]
};

const sync_func = {
    FunctionName: 'sync_s3_to_azure',
    Description: 'Sync S3 bucket to Azure blob',
    Runtime: 'nodejs6',
    Handler: 'sync_s3_to_azure.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'sync_s3_to_azure.js',
        fs_path: path.join(__dirname, 'sync_s3_to_azure.js'),
    }]
};

const read_bucket_func = {
    FunctionName: 'read_bucket',
    Description: 'Get bucket information',
    Runtime: 'nodejs6',
    Handler: 'read_bucket_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'read_bucket_func.js',
        fs_path: path.join(__dirname, 'read_bucket_func.js'),
    }]
};

// const RB_EVENT = {
//     "name": "files",
// };

const create_bucket_func = {
    FunctionName: 'create_bucket',
    Description: 'create bucket and associate it to pool',
    Runtime: 'nodejs6',
    Handler: 'create_bucket_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'create_bucket_func.js',
        fs_path: path.join(__dirname, 'create_bucket_func.js'),
    }]
};

// const CB_EVENT = {
//     "name": "momo10",
//     "data_placement": "SPREAD",
//     "pools": ["london"]
// };

const set_account_bucket_permissions_func = {
    FunctionName: 'set_account_bucket_permissions',
    Description: 'Set account permissions on buckets',
    Runtime: 'nodejs6',
    Handler: 'set_account_bucket_permissions_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'set_account_bucket_permissions_func.js',
        fs_path: path.join(__dirname, 'set_account_bucket_permissions_func.js')
    }]
};

const SP_EVENT = {
    "email": "new@aaa.com",
    "s3_access": true,
    "default_pool": "london",
    "allowed_buckets": ['logs']
};

const create_account_func = {
    FunctionName: 'create_account',
    Description: 'Create User Account',
    Runtime: 'nodejs6',
    Handler: 'create_account_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'create_account_func.js',
        fs_path: path.join(__dirname, 'create_account_func.js'),
    }]
};

/*
const CA_EVENT = {
    "name": "eran2",
    "email": "eran2@noobaa.com",
    "password": "MyPassw0rd",
    "s3_access": true,
    "allowed_buckets": ["movies", "files"],
    "default_pool": "default_pool"
};
*/

const set_account_ip_access_func = {
    FunctionName: 'set_account_ip_access',
    Description: 'Set dedicated IP per account',
    Runtime: 'nodejs6',
    Handler: 'set_account_ip_access_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'set_account_ip_access_func.js',
        fs_path: path.join(__dirname, 'set_account_ip_access_func.js'),
    }]
};

// const SA_EVENT = {
//     "email": "test@noobaa.com",
//     "ips": ["1.1.1.1"]
// };

const WC_EVENT = {
    text: 'a',
    // random: 20,
    // url: argv.url || 'http://127.0.0.1:5001',
    // return_text: argv.return_text,
};

const DOS_EVENT = {
    lambda_conf: LAMBDA_CONF,
    func_name: word_count_func.FunctionName,
    func_event: WC_EVENT,
    time: 3000,
    concur: 2,
};


function main() {
    if (argv.show) return show();
    if (argv.install) return install();
    if (argv.test) return test();
    if (argv.dildos) return dildos();
    if (argv.clear) return clear();
    console.log('Usage: --show|--install|--test|--dildos|--clear');
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
    if (argv.install === 'sync') {
        return install_func(sync_func);
    }
    if (argv.install === 'account') {
        return P.resolve()
            .then(() => install_func(create_account_func))
            .then(() => install_func(set_account_bucket_permissions_func))
            .then(() => install_func(set_account_ip_access_func));
    }
    if (argv.install === 'bucket') {
        return P.resolve()
            .then(() => install_func(read_bucket_func))
            .then(() => install_func(create_account_func));
    }
    return P.resolve()
        .then(() => install_func(word_count_func))
        .then(() => install_func(dos_func))
        .then(() => install_func(sync_func))
        .then(() => install_func(create_account_func))
        .then(() => install_func(set_account_ip_access_func))
        .then(() => install_func(read_bucket_func))
        .then(() => install_func(create_bucket_func))
        .then(() => install_func(set_account_bucket_permissions_func));
}

function install_func(fn) {
    console.log('Creating Function:', fn);
    return P.resolve()
        .then(() => prepare_func(fn))
        .then(() => P.fromCallback(callback => lambda.deleteFunction({
            FunctionName: fn.FunctionName,
        }, callback))
            .catch(err => {
                console.log('Delete function if exist:', fn.FunctionName, err.message);
            }))
        .then(() => P.fromCallback(callback => lambda.createFunction(fn, callback)))
        .then(() => console.log('created.'));
}

function clear() {
    return P.fromCallback(callback => lambda.listFunctions({}, callback))
        .then(res => P.each(res.Functions,
            f => P.fromCallback(callback => lambda.deleteFunction({
                FunctionName: f.FunctionName,
            }, callback))
                .catch(err => {
                    console.log('Delete function if exist:.', f.FunctionName, err.message);
                })
        ));
}

function prepare_func(fn) {
    return P.resolve()
        .then(() => zip_utils.zip_from_files(fn.Files))
        .then(zipfile => zip_utils.zip_to_buffer(zipfile))
        .then(zip_buffer => {
            delete fn.Files;
            fn.Code = {
                ZipFile: zip_buffer
            };
        });
}

function test() {
    const params = argv.test === 'dos' ? {
        FunctionName: dos_func.FunctionName,
        Payload: JSON.stringify(DOS_EVENT),
    } : {
            FunctionName: set_account_bucket_permissions_func.FunctionName,
            Payload: JSON.stringify(SP_EVENT)
            // FunctionName: create_account_func.FunctionName,
            // Payload: JSON.stringify(CA_EVENT)
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
        Payload: JSON.stringify(DOS_EVENT),
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
