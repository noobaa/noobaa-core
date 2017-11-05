/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
const AWS = require('aws-sdk');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');

mocha.describe('s3_ops', function() {

    const { rpc_client, EMAIL } = coretest;
    const BKT1 = 'test-s3-ops-bucket-ops';
    const BKT2 = 'test-s3-ops-object-ops';
    let s3;

    mocha.before(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        return P.resolve()
            .then(() => rpc_client.account.read_account({
                email: EMAIL,
            }))
            .then(account_info => {
                s3 = new AWS.S3({
                    endpoint: coretest.get_http_address(),
                    accessKeyId: account_info.access_keys[0].access_key,
                    secretAccessKey: account_info.access_keys[0].secret_key,
                    s3ForcePathStyle: true,
                    signatureVersion: 'v4',
                    computeChecksums: true,
                    s3DisableBodySigning: false,
                    region: 'us-east-1',
                    httpOptions: { agent: new http.Agent({ keepAlive: false }) },
                });
                console.log('S3 CONFIG', s3.config);
            });
    });

    mocha.describe('bucket-ops', function() {
        mocha.it('should create bucket', function() {
            return s3.createBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should head bucket', function() {
            return s3.headBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should list buckets with one bucket', function() {
            return s3.listBuckets().promise()
                .then(res => assert(res.Buckets.find(bucket => bucket.Name === BKT1)));
        });
        mocha.it('should delete bucket', function() {
            return s3.deleteBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should list buckets after no buckets left', function() {
            return s3.listBuckets().promise()
                .then(res => assert(!res.Buckets.find(bucket => bucket.Name === BKT1)));
        });
    });

    mocha.describe('object-ops', function() {
        mocha.before(function() {
            return s3.createBucket({ Bucket: BKT2 }).promise();
        });
        mocha.it('should create text-file', function() {
            return s3.putObject({ Bucket: BKT2, Key: 'text-file', Body: '', ContentType: 'text/plain' }).promise();
        });
        mocha.it('should head text-file', function() {
            return s3.headObject({ Bucket: BKT2, Key: 'text-file' }).promise();
        });
        mocha.it('should get text-file', function() {
            return s3.getObject({ Bucket: BKT2, Key: 'text-file' }).promise()
                .then(res => {
                    assert.strictEqual(res.Body.toString(), '');
                    assert.strictEqual(res.ContentType, 'text/plain');
                    assert.strictEqual(res.ContentLength, 0);
                });
        });
        mocha.it('should list objects with text-file', function() {
            return s3.listObjects({ Bucket: BKT2 }).promise()
                .then(res => {
                    assert.strictEqual(res.Contents[0].Key, 'text-file');
                    assert.strictEqual(res.Contents[0].Size, 0);
                    assert.strictEqual(res.Contents.length, 1);
                });
        });
        mocha.it('should delete text-file', function() {
            return s3.deleteObject({ Bucket: BKT2, Key: 'text-file' }).promise();
        });
        mocha.it('should list objects after no objects left', function() {
            return s3.listObjects({ Bucket: BKT2 }).promise()
                .then(res => assert.strictEqual(res.Contents.length, 0));
        });
        mocha.after(function() {
            return s3.deleteBucket({ Bucket: BKT2 }).promise();
        });
    });

});
