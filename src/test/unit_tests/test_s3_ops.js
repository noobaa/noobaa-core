/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
const AWS = require('aws-sdk');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');

mocha.describe('s3_ops', function() {

    const client = coretest.new_test_client();
    const SYS = 'test-s3-system';
    const EMAIL = 'test-s3-email@mail.mail';
    const PASSWORD = 'test-s3-password';
    let s3 = new AWS.S3();

    mocha.before(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        return P.resolve()
            .then(() => coretest.create_system(client, {
                activation_code: '1111',
                name: SYS,
                email: EMAIL,
                password: PASSWORD
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => client.account.read_account({
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
                });
                console.log('S3 CONFIG', s3.config);
            });
    });

    // mocha.after(function() {
    //     const self = this; // eslint-disable-line no-invalid-this
    //     self.timeout(60000);
    // });


    mocha.describe('bucket-ops', function() {
        mocha.it('should create bucket', function() {
            return s3.createBucket({ Bucket: 'bucket-ops' }).promise();
        });
        mocha.it('should head bucket', function() {
            return s3.headBucket({ Bucket: 'bucket-ops' }).promise();
        });
        mocha.it('should list buckets with one bucket', function() {
            return s3.listBuckets().promise()
                .then(res => {
                    assert.strictEqual(res.Buckets[0].Name, 'first.bucket');
                    assert.strictEqual(res.Buckets[1].Name, 'bucket-ops');
                    assert.strictEqual(res.Buckets.length, 2);
                });
        });
        mocha.it('should delete bucket', function() {
            return s3.deleteBucket({ Bucket: 'bucket-ops' }).promise();
        });
        mocha.it('should list buckets after no buckets left', function() {
            return s3.listBuckets().promise()
                .then(res => {
                    assert.strictEqual(res.Buckets[0].Name, 'first.bucket');
                    assert.strictEqual(res.Buckets.length, 1);
                });
        });
    });

    mocha.describe('object-ops', function() {
        mocha.before(function() {
            return s3.createBucket({ Bucket: 'object-ops' }).promise();
        });
        mocha.it('should create text-file', function() {
            return s3.putObject({ Bucket: 'object-ops', Key: 'text-file', Body: '', ContentType: 'text/plain' }).promise();
        });
        mocha.it('should head text-file', function() {
            return s3.headObject({ Bucket: 'object-ops', Key: 'text-file' }).promise();
        });
        mocha.it('should get text-file', function() {
            return s3.getObject({ Bucket: 'object-ops', Key: 'text-file' }).promise()
                .then(res => {
                    assert.strictEqual(res.Body.toString(), '');
                    assert.strictEqual(res.ContentType, 'text/plain');
                    assert.strictEqual(res.ContentLength, 0);
                });
        });
        mocha.it('should list objects with text-file', function() {
            return s3.listObjects({ Bucket: 'object-ops' }).promise()
                .then(res => {
                    assert.strictEqual(res.Contents[0].Key, 'text-file');
                    assert.strictEqual(res.Contents[0].Size, 0);
                    assert.strictEqual(res.Contents.length, 1);
                });
        });
        mocha.it('should delete text-file', function() {
            return s3.deleteObject({ Bucket: 'object-ops', Key: 'text-file' }).promise();
        });
        mocha.it('should list objects after no objects left', function() {
            return s3.listObjects({ Bucket: 'object-ops' }).promise()
                .then(res => assert.strictEqual(res.Contents.length, 0));
        });
        mocha.after(function() {
            return s3.deleteBucket({ Bucket: 'object-ops' }).promise();
        });
    });

});
