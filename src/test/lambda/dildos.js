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

const url_hash_func = {
    FunctionName: 'url_hash_func',
    Description: 'Get from URL and calculate HASH',
    Runtime: 'nodejs6',
    Handler: 'index.handler',
    Role: 'arn:aws:iam::638243541865:role/lambda-test',
    VpcConfig: {
        SubnetIds: _.isArray(argv.pool) ? argv.pool : [argv.pool]
    },
    Files: {
        'index.js': function() {
            const http = require('http');
            const crypto = require('crypto');
            exports.handler = function(event, context, callback) {
                event = event || {};
                // var url = event.url || 'http://lorempixel.com/256/256/';
                var url = event.url || 'http://www.google.com';
                var hash = event.hash || 'sha1';
                var encoding = event.encoding || 'hex';
                var h = crypto.createHash(hash);
                var num_bytes = 0;
                http.get(url, res => res
                        .once('error', err => callback(err))
                        .on('data', data => {
                            num_bytes += data.length;
                            h.update(data);
                        })
                        .once('end', () => callback(null, {
                            num_bytes: num_bytes,
                            hash: h.digest(encoding)
                        }))
                    )
                    .once('error', err => callback(err));
            };
        }
    }
};

const denial_func = {
    FunctionName: 'denial_func',
    Description: 'Denial of service',
    Runtime: 'nodejs6',
    Handler: 'index.handler',
    Role: 'arn:aws:iam::638243541865:role/lambda-test',
    VpcConfig: {
        SubnetIds: _.isArray(argv.pool) ? argv.pool : [argv.pool]
    },
    Files: {
        'index.js': function() {
            exports.handler = function(event, context, callback) {
                event = event || {};
                var func_name = event.func_name || 'url_hash_func';
                var args = event.args || {};
                var max_millis = event.max_millis || 1000;
                var max_calls = event.max_calls || 1000;
                var concur = event.concur || 1;
                var start = Date.now();
                var end = start + max_millis;
                var num_calls = 0;
                var num_bytes = 0;
                var num_errors = 0;
                for (var i = 0; i < concur; ++i) {
                    worker();
                }

                function worker() {
                    var now = Date.now();
                    if (num_calls >= max_calls || now >= end) {
                        return callback(null, {
                            num_calls: num_calls,
                            num_bytes: num_bytes,
                            num_errors: num_errors,
                            took: now - start,
                        });
                    }
                    num_calls += 1;
                    context.invoke_lambda(func_name, args, function(err, res) {
                        if (err) {
                            num_errors += 1;
                        }
                        if (res) {
                            var reply = res.Response || JSON.parse(res.Payload);
                            num_bytes += reply.num_bytes;
                        }
                        setImmediate(worker);
                    });
                }
            };
        }
    }
};

/*
const image_resize_func = {
    FunctionName: 'image_resize_func',
    Description: 'image_resize_func',
    Runtime: 'nodejs6',
    Handler: 'index.handler',
    Role: 'arn:aws:iam::638243541865:role/lambda-test',
    Files: {
        'package.json': {
            // TODO support deps install
            dependencies: {
                jimp: '0.2.27'
            },
        },
        'index.js': function() {
            const jimp = require('jimp');
            exports.handler = function(event, context, callback) {
                var url = event.url || 'http://lorempixel.com/256/256/';
                var x = event.x || 64;
                var y = event.y || 64;
                jimp.read(url, function(err, image) {
                    if (err) return callback(err);
                    image.resize(x, y);
                    // TODO encode and return the image
                });
            };
        }
    }
};
*/


function main() {
    if (argv.show) return show();
    if (argv.install) return install();
    if (argv.test) return test();
    if (argv.dildos) return dildos();
    console.log('Usage: --show|--install|--test|--dildos');
}

function show() {
    console.error('TODO: implement --show');
}

function install() {
    if (argv.install === 'denial') {
        return install_func(denial_func);
    }
    if (argv.install === 'service') {
        return install_func(url_hash_func);
    }
    return P.resolve()
        .then(() => install_func(url_hash_func))
        .then(() => install_func(denial_func));
}

function install_func(fn) {
    console.log('Creating Function:', fn);
    return P.resolve()
        .then(() => prepare_func(fn))
        .then(() => P.fromCallback(callback => lambda.deleteFunction({
            FunctionName: fn.FunctionName,
        }, callback)).catch(err => {
            // ignore errors
        }))
        .then(() => P.fromCallback(callback => lambda.createFunction(fn, callback)))
        .then(() => console.log('created.'));
}

function prepare_func(fn) {
    if (fn.Code) return;
    return P.resolve()
        .then(() => zip_utils.zip_in_memory(
            _.mapValues(fn.Files, f => {
                if (!_.isFunction(f)) {
                    return Buffer.from(JSON.stringify(f));
                }
                const s = f.toString();
                return Buffer.from(s.slice(s.indexOf('{') + 1, s.length - 1));
            })
        ))
        .then(zipfile => {
            delete fn.Files;
            fn.Code = {
                ZipFile: zipfile
            };
        });
}

function test() {
    const params = {
        FunctionName: denial_func.FunctionName,
        // FunctionName: url_hash_func.FunctionName,
        // Payload: JSON.stringify({}),
    };
    return P.fromCallback(callback => lambda.invoke(params, callback))
        .then(res => console.log('Result:', res, 'from', params));
}

function dildos() {
    const max_calls = argv.max_calls || 10000;
    const max_millis = argv.max_millis || 10000;
    const concur = argv.concur || 1;
    const start = Date.now();
    const end = start + max_millis;
    let num_calls = 0;
    let num_bytes = 0;
    let num_errors = 0;
    let took_sum = 0;
    console.log(`DILDOS Starting: concur ${concur} max_millis ${max_millis} max_calls ${max_calls}`);

    const params = {
        FunctionName: denial_func.FunctionName,
        // FunctionName: url_hash_func.FunctionName,
        // Payload: JSON.stringify({}),
    };

    function worker() {
        const now = Date.now();
        if (num_calls >= max_calls || now >= end) return;
        return P.fromCallback(callback => lambda.invoke(params, callback))
            .then(res => {
                if (argv.debug) {
                    console.log('Result:', res, 'from', params);
                }
                const reply = res.Response || JSON.parse(res.Payload);
                num_calls += reply.num_calls;
                num_bytes += reply.num_bytes;
                num_errors += reply.num_errors;
                took_sum += reply.took;
                report();
            })
            .then(worker);
    }

    function report() {
        const took = Date.now() - start;
        const calls_per_sec = (num_calls * 1000 / took).toFixed(3);
        const avg_latency = (took_sum / num_calls).toFixed(3);
        console.log(`Averages: Calls per second ${calls_per_sec} Latency ${avg_latency}ms`);
    }

    return P.map(_.times(concur), worker)
        .then(() => {
            report();
            const took = Date.now() - start;
            // const time = (took / 1000).toFixed(3);
            const throughput = (num_bytes * 1000 / took / 1024).toFixed(3);
            console.log(`Done: Total number of Calls ${num_calls} Throughput ${throughput} KB/sec Num Errors ${num_errors}`);
        });
}


main();
