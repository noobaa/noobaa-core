/* Copyright (C) 2016 NooBaa */
'use strict';

var AWS = require('aws-sdk');
var api = require('../../api');
var rpc = api.new_rpc();
var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
var basic_server_ops = require('../utils/basic_server_ops');
// var _ = require('lodash');
// var assert = require('assert');
// var promise_utils = require('../../util/promise_utils');
var dotenv = require('../../util/dotenv');
var http = require('http');
dotenv.load();

let TEST_PARAMS = {
    ip: argv.ip || 'localhost',
    bucket: argv.bucket || 'first.bucket',
    port: argv.target_port || process.env.PORT,
    access_key: argv.access_key || '123',
    secret_key: argv.secret_key || 'abc',
};

var client = rpc.new_client({
    address: 'ws://localhost:' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
}

function test_s3_connection() {
    return P.fcall(function() {
            var s3 = new AWS.S3({
                endpoint: TEST_PARAMS.ip,
                accessKeyId: TEST_PARAMS.access_key,
                secretAccessKey: TEST_PARAMS.secret_key,
                sslEnabled: false,
                s3ForcePathStyle: true,
                signatureVersion: 'v4',
                region: 'eu-central-1',
            });
            return P.ninvoke(s3, "listBuckets");
        })
        .then(() => true,
            error => {
                console.warn('Failed with', error, error.stack);
                throw new Error(error);
            }
        );
}

/*
function list_buckets() {
    return P.fcall(function() {
            var s3 = new AWS.S3({
                endpoint: TEST_PARAMS.ip,
                accessKeyId: TEST_PARAMS.access_key,
                secretAccessKey: TEST_PARAMS.secret_key,
                sslEnabled: false,
                s3ForcePathStyle: true,
                signatureVersion: 'v4',
                region: 'eu-central-1',
            });
            return P.ninvoke(s3, "listBuckets");
        })
        .then((res) => res,
            (error) => {
                console.warn('Failed with', error, error.stack);
                process.exit(1);
            }
        );
}
*/

function getSignedUrl(bucket, obj, expiry) {
    console.log('GENERATE SIGNED_URL OBJECT: ', obj, ' FROM BUCKET: ', bucket);
    return P.fcall(function() {
            var s3 = new AWS.S3({
                endpoint: TEST_PARAMS.ip,
                accessKeyId: TEST_PARAMS.access_key,
                secretAccessKey: TEST_PARAMS.secret_key,
                sslEnabled: false,
                s3ForcePathStyle: true,
                signatureVersion: 'v4',
                region: 'eu-central-1',
            });
            return s3.getSignedUrl('getObject', {
                Bucket: bucket,
                Key: obj,
                Expires: expiry || 604800
            });
        })
        .then(() => P.delay(1000))
        .then(url => url,
            error => {
                console.warn('Failed with', error, error.stack);
                throw new Error(error);
            }
        );
}

function httpGetAsPromise(url) {
    console.log('TEST SIGNED_URL: ', url);
    return new Promise(function(resolve, reject) {
        return http.get(url, res => {
            if (res.statusCode >= 400) {
                reject(new Error(`httpGetAsPromise failed ${url} ${res.statusCode} ${res.body}`));
            } else {
                resolve(res);
            }
        });
    });
}

function create_bucket(name) {
    console.log('CREATE BUCKET: ', name);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.createBucket({
            Bucket: name
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}

function create_folder(bucket, folder) {
    console.log('CREATE FOLDER: ', folder, ' IN BUCKET: ', bucket);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.putObject({
            Bucket: bucket,
            Key: folder + '/'
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}

function head_object(bucket, key) {
    console.log('HEAD OBJECT: ', key, ' FROM BUCKET: ', bucket);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.headObject({
            Bucket: bucket,
            Key: key
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}

function get_object(bucket, key) {
    console.log('GET OBJECT: ', key, ' FROM BUCKET: ', bucket);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.getObject({
            Bucket: bucket,
            Key: key
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}

function delete_object(bucket, key) {
    console.log('DELETE OBJECT: ', key, ' FROM BUCKET: ', bucket);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        s3.deleteObject({
                Bucket: bucket,
                Key: key
            },
            function(err, data) {
                if (err) {
                    console.warn('Failed with', err, err.stack);
                    throw new Error(err);
                } else {
                    return data;
                }
            });
    });
}

function delete_bucket(name) {
    console.log('DELETE BUCKET: ', name);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.deleteBucket({
            Bucket: name
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return (data);
            }
        });
    });
}

function delete_folder(bucket, folder) {
    console.log('DELETE FOLDER: ', folder, ' FROM BUCKET: ', bucket);
    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: TEST_PARAMS.ip,
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
            sslEnabled: false,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: 'eu-central-1',
        });
        return s3.deleteObject({
            Bucket: bucket,
            Key: folder + '/'
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function() {
            process.exit(1);
        });
}

function run_test() {
    let file_sizes = [1, 2, 3];
    let file_names = ['c3_нуба_1', 'c3_нуба_2', 'c3_нуба_3'];
    let fkey;
    let signed_url;
    return authenticate().then(() => test_s3_connection())
        .then(() => basic_server_ops.generate_random_file(file_sizes[0]))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 'first.bucket', file_names[0]);
        })
        .then(() => P.delay(1000))
        .then(() => head_object('first.bucket', file_names[0]))
        .then(() => P.delay(1000))
        .then(() => get_object('first.bucket', file_names[0]))
        .then(() => P.delay(1000))
        .then(() => getSignedUrl('first.bucket', file_names[0]))
        .then(url => {
            signed_url = url;
            return httpGetAsPromise(url);
        })
        .then(() => P.delay(1000))
        .then(() => create_bucket('s3testbucket'))
        .then(() => basic_server_ops.generate_random_file(file_sizes[1]))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 's3testbucket', file_names[1]);
        })
        .then(() => P.delay(1000))
        .then(() => head_object('s3testbucket', file_names[1]))
        .then(() => P.delay(1000))
        .then(() => get_object('s3testbucket', file_names[1]))
        .then(() => P.delay(1000))
        .then(() => getSignedUrl('s3testbucket', file_names[1]))
        .then(url => {
            signed_url = url;
            return httpGetAsPromise(url);
        })
        .then(() => P.delay(1000))
        .then(() => create_folder('s3testbucket', 's3folder'))
        .then(() => basic_server_ops.generate_random_file(file_sizes[2]))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 's3testbucket', 's3folder/' + file_names[2]);
        })
        .then(() => P.delay(1000))
        .then(() => head_object('s3testbucket', 's3folder/' + file_names[2]))
        .then(() => P.delay(1000))
        .then(() => get_object('s3testbucket', 's3folder/' + file_names[2]))
        .then(() => P.delay(1000))
        .then(() => getSignedUrl('s3testbucket', 's3folder/' + file_names[2]))
        .then(url => {
            signed_url = url;
            return httpGetAsPromise(url);
        })
        .then(() => P.delay(1000))
        .then(() => getSignedUrl('s3testbucket', 's3folder/' + file_names[2], 1))
        .then(url => {
            signed_url = url;
            return httpGetAsPromise(url);
        })
        .catch(err => {
            // We expect the above URL to fail for Expiry reason
            if (err && err.url) {
                if (String(signed_url) === String(err.url)) {
                    return true;
                }
            }
            console.error(err.stack || err);
            throw new Error(err);
        })
        .then(() => P.delay(1000))
        .then(() => delete_object('first.bucket', file_names[0]))
        .then(() => P.delay(1000))
        .then(() => delete_object('s3testbucket', file_names[1]))
        .then(() => P.delay(1000))
        .then(() => delete_object('s3testbucket', 's3folder/' + file_names[2]))
        .then(() => P.delay(1000))
        .then(() => delete_folder('s3testbucket', 's3folder'))
        .then(() => P.delay(1000))
        .then(() => delete_bucket('s3testbucket'))
        .then(() => P.delay(1000))
        .then(() => {
            console.log('test_s3_authentication PASSED');
            rpc.disconnect_all();
        })
        .catch(err => {
            rpc.disconnect_all();
            console.error('test_s3_authentication FAILED: ', err.stack || err);
            throw new Error(`test_s3_authentication FAILED: ${err}`);
        });
}

if (require.main === module) {
    main();
}
