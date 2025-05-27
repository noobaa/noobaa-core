/* Copyright (C) 2016 NooBaa */
'use strict';

const { S3, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const api = require('../../api');
const rpc = api.new_rpc();
const argv = require('minimist')(process.argv);
const P = require('../../util/promise');
const basic_server_ops = require('../utils/basic_server_ops');
// var _ = require('lodash');
// var assert = require('assert');
// var promise_utils = require('../../util/promise_utils');
const dotenv = require('../../util/dotenv');
const http = require('http');
dotenv.load();

const TEST_PARAMS = {
    ip: argv.ip || 'localhost',
    bucket: argv.bucket || 'first.bucket',
    port: argv.target_port || process.env.PORT,
    access_key: argv.access_key || '123',
    secret_key: argv.secret_key || 'abc',
};

const client = rpc.new_client({
    address: 'ws://localhost:' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

function authenticate() {
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
}

async function test_s3_connection() {
        try {
            const s3 = create_s3_client();
            await s3.listBuckets({});
        } catch (error) {
            console.warn('Failed with', error, error.stack);
            throw new Error(error);
        }
        return true;
}

async function getSignedS3Url(bucket, obj, expiry) {
    console.log('GENERATE SIGNED_URL OBJECT: ', obj, ' FROM BUCKET: ', bucket);
    try {
        const s3 = create_s3_client();
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: obj,
        });
        return await getSignedUrl(s3, command, { expiresIn: expiry || 604800 });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
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

function create_s3_client() {
    return new S3({
        endpoint: TEST_PARAMS.ip,
        credentials: {
            accessKeyId: TEST_PARAMS.access_key,
            secretAccessKey: TEST_PARAMS.secret_key,
        },
        tls: false,
        forcePathStyle: true,
        // signatureVersion is Deprecated in SDK v3
        //signatureVersion: 'v4',
        region: 'eu-central-1',
    });
}

async function create_bucket(name) {
    console.log('CREATE BUCKET: ', name);
    try {
        const s3 = create_s3_client();
        return await s3.createBucket({ Bucket: name });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw err;
    }
}

async function create_folder(bucket, folder) {
    console.log('CREATE FOLDER: ', folder, ' IN BUCKET: ', bucket);
    try {
        const s3 = create_s3_client();
        return await s3.putObject({
            Bucket: bucket,
            Key: folder + '/'
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
}

async function head_object(bucket, key) {
    console.log('HEAD OBJECT: ', key, ' FROM BUCKET: ', bucket);
    try {
         const s3 = create_s3_client();
        return await s3.headObject({
            Bucket: bucket,
            Key: key
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
}

async function get_object(bucket, key) {
    console.log('GET OBJECT: ', key, ' FROM BUCKET: ', bucket);
    try {
        const s3 = create_s3_client();
        return await s3.getObject({
            Bucket: bucket,
            Key: key
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
}

async function delete_object(bucket, key) {
    console.log('DELETE OBJECT: ', key, ' FROM BUCKET: ', bucket);
    try {
        const s3 = create_s3_client();
        return await s3.deleteObject({
            Bucket: bucket,
            Key: key
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
}

async function delete_bucket(name) {
    console.log('DELETE BUCKET: ', name);
    try {
        const s3 = create_s3_client();
        return await s3.deleteBucket({
            Bucket: name
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
}

async function delete_folder(bucket, folder) {
    console.log('DELETE FOLDER: ', folder, ' FROM BUCKET: ', bucket);
    try {
        const s3 = create_s3_client();
        return await s3.deleteObject({
            Bucket: bucket,
            Key: folder + '/'
        });
    } catch (err) {
        console.warn('Failed with', err, err.stack);
        throw new Error(err);
    }
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

/* eslint-disable max-statements */
async function run_test() {
    const file_sizes = [1, 2, 3];
    const file_names = ['c3_нуба_1', 'c3_нуба_2', 'c3_нуба_3'];
    let fkey;
    let signed_url;
    try {
        await authenticate();
        await test_s3_connection();
        fkey = await basic_server_ops.generate_random_file(file_sizes[0]);
        await basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 'first.bucket', file_names[0]);
        await P.delay(1000);
        await head_object('first.bucket', file_names[0]);
        await P.delay(1000);
        await get_object('first.bucket', file_names[0]);
        await P.delay(1000);
        signed_url = await getSignedS3Url('first.bucket', file_names[0]);
        await httpGetAsPromise(signed_url);
        await P.delay(1000);
        await create_bucket('s3testbucket');
        fkey = await basic_server_ops.generate_random_file(file_sizes[1]);
        await basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 's3testbucket', file_names[1]);
        await P.delay(1000);
        await head_object('s3testbucket', file_names[1]);
        await P.delay(1000);
        await get_object('s3testbucket', file_names[1]);
        await P.delay(1000);
        signed_url = await getSignedS3Url('s3testbucket', file_names[1]);
        await httpGetAsPromise(signed_url);
        await P.delay(1000);
        await create_folder('s3testbucket', 's3folder');
        fkey = await basic_server_ops.generate_random_file(file_sizes[2]);
        await basic_server_ops.upload_file(TEST_PARAMS.ip, fkey, 's3testbucket', 's3folder/' + file_names[2]);
        await P.delay(1000);
        await head_object('s3testbucket', 's3folder/' + file_names[2]);
        await P.delay(1000);
        await get_object('s3testbucket', 's3folder/' + file_names[2]);
        await P.delay(1000);
        signed_url = await getSignedS3Url('s3testbucket', 's3folder/' + file_names[2]);
        await httpGetAsPromise(signed_url);
        await P.delay(1000);
        try {
            signed_url = await getSignedS3Url('s3testbucket', 's3folder/' + file_names[2], 1);
            // We expect the above URL to fail for Expiry reason
            await httpGetAsPromise(signed_url);
        } catch (err) {
            if (err.url) {
                if (String(signed_url) === String(err.url)) {
                    return true;
                }
            }
            console.error(err.stack || err);
            throw new Error(err);
        }
        await P.delay(1000);
        await delete_object('first.bucket', file_names[0]);
        await P.delay(1000);
        await delete_object('s3testbucket', file_names[1]);
        await P.delay(1000);
        await delete_object('s3testbucket', 's3folder/' + file_names[2]);
        await P.delay(1000);
        await delete_folder('s3testbucket', 's3folder');
        await P.delay(1000);
        await delete_bucket('s3testbucket');
        await P.delay(1000);
        console.log('test_s3_authentication PASSED');
        rpc.disconnect_all();
    } catch (err) {
        rpc.disconnect_all();
        console.error('test_s3_authentication FAILED: ', err.stack || err);
        throw new Error(`test_s3_authentication FAILED: ${err}`);
    }
}

if (require.main === module) {
    main();
}
