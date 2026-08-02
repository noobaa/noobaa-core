/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const config = require('../../../../../config');
const { require_coretest, TMP_PATH } = require('../../../system_tests/test_utils');
const coretest = require_coretest();
const { rpc_client, EMAIL, POOL_LIST } = coretest;
coretest.setup({ pools_to_create: process.env.NC_CORETEST ? undefined : [POOL_LIST[1]] });
const path = require('path');
const fs_utils = require('../../../../util/fs_utils');

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');

// Force IPv4 loopback — connecting to "localhost" often uses ::1 on dual-stack hosts,
// which would not match aws:SourceIp policies written for 127.0.0.1.
const LOOPBACK_IP = '127.0.0.1';
const OTHER_CIDR = '10.0.0.0/8'; // a range that never includes 127.0.0.1

const BKT = 'test-source-ip-bucket-policy';
const KEY = 'file1.txt';
const BODY = 'source-ip-test-body';

let s3_owner;
let s3_user;

async function assert_access_denied(promise) {
    try {
        await promise;
        assert.fail('Expected Access Denied but the request succeeded');
    } catch (err) {
        if (err.message !== 'Access Denied') throw err;
    }
}

function loopback_http_address() {
    return coretest.get_http_address().replace('localhost', LOOPBACK_IP);
}

async function setup() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);

    const tmp_fs_root = path.join(TMP_PATH, 'test_s3_bucket_policy_source_ip');
    const s3_creds = {
        endpoint: loopback_http_address(),
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false, family: 4 })
        }),
    };

    if (process.env.NC_CORETEST) {
        await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
    }

    const nsr = 'source_ip_policy_nsr';
    const account = {
        has_login: false,
        s3_access: true,
        default_resource: process.env.NC_CORETEST ? nsr : POOL_LIST[1].name,
    };
    if (process.env.NC_CORETEST) {
        account.nsfs_account_config = {
            uid: process.getuid(),
            gid: process.getgid(),
            new_buckets_path: tmp_fs_root,
        };
    }

    const admin_info = await rpc_client.account.read_account({ email: EMAIL });
    const admin_keys = admin_info.access_keys;

    const user_name = 'source-ip-test-user@test.com';
    account.name = user_name;
    account.email = user_name;
    const user_details = await rpc_client.account.create_account(account);
    const user_keys = user_details.access_keys;

    s3_creds.credentials = {
        accessKeyId: admin_keys[0].access_key.unwrap(),
        secretAccessKey: admin_keys[0].secret_key.unwrap(),
    };
    s3_owner = new S3(s3_creds);

    s3_creds.credentials = {
        accessKeyId: user_keys[0].access_key.unwrap(),
        secretAccessKey: user_keys[0].secret_key.unwrap(),
    };
    s3_user = new S3(s3_creds);

    await s3_owner.createBucket({ Bucket: BKT });

    // seed an object for GetObject tests
    await s3_owner.putObject({ Bucket: BKT, Key: KEY, Body: BODY });
}

mocha.describe('s3_bucket_policy — aws:SourceIp condition', function() {
    mocha.before(setup);

    mocha.after(async function() {
        await s3_owner.deleteObject({ Bucket: BKT, Key: KEY }).catch(() => undefined);
        await s3_owner.deleteBucket({ Bucket: BKT }).catch(() => undefined);
    });

    // ------------------------------------------------------------------ helpers
    function ip_allow_policy(cidr_or_ip) {
        return {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: '*' },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`],
                Condition: { IpAddress: { 'aws:SourceIp': cidr_or_ip } },
            }],
        };
    }

    function ip_deny_policy(cidr_or_ip) {
        return {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: '*' },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT}/*`],
                },
                {
                    Effect: 'Deny',
                    Principal: { AWS: '*' },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT}/*`],
                    Condition: { NotIpAddress: { 'aws:SourceIp': cidr_or_ip } },
                },
            ],
        };
    }

    // ------------------------------------------------------------------ IpAddress Allow
    mocha.describe('IpAddress operator — Allow statement', function() {
        mocha.it('should allow GetObject when client IP matches the allowed CIDR', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy('127.0.0.1/32')),
            });
            const res = await s3_user.getObject({ Bucket: BKT, Key: KEY });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });

        mocha.it('should deny GetObject when client IP is outside the allowed CIDR', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy(OTHER_CIDR)),
            });
            await assert_access_denied(s3_user.getObject({ Bucket: BKT, Key: KEY }));
        });

        mocha.it('should allow GetObject when client IP matches one of multiple CIDRs', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy([OTHER_CIDR, `${LOOPBACK_IP}/32`])),
            });
            const res = await s3_user.getObject({ Bucket: BKT, Key: KEY });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });

        mocha.it('should deny GetObject when client IP matches none of multiple CIDRs', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy([OTHER_CIDR, '192.0.2.0/24'])),
            });
            await assert_access_denied(s3_user.getObject({ Bucket: BKT, Key: KEY }));
        });
    });

    // ------------------------------------------------------------------ NotIpAddress Deny
    mocha.describe('NotIpAddress operator — Deny statement (block all except range)', function() {
        mocha.it('should allow GetObject when client IP is inside the allowed range', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_deny_policy('127.0.0.1/32')),
            });
            const res = await s3_user.getObject({ Bucket: BKT, Key: KEY });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });

        mocha.it('should deny GetObject when client IP is outside the allowed range', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_deny_policy(OTHER_CIDR)),
            });
            await assert_access_denied(s3_user.getObject({ Bucket: BKT, Key: KEY }));
        });
    });

    // ------------------------------------------------------------------ putBucketPolicy schema validation
    mocha.describe('putBucketPolicy schema validation', function() {
        mocha.it('should accept a policy with IpAddress condition', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const res = await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy('127.0.0.1/32')),
            });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });

        mocha.it('should accept a policy with NotIpAddress condition', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const res = await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_deny_policy('127.0.0.1/32')),
            });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });

        mocha.it('should accept a policy with an array of CIDRs', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const res = await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(ip_allow_policy(['127.0.0.1/32', '192.0.2.0/24'])),
            });
            assert.equal(res.$metadata.httpStatusCode, 200);
        });
    });
});
