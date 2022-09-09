/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const AWS = require('aws-sdk');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const todayPlus15 = new Date(today);
todayPlus15.setDate(todayPlus15.getDate() + 15);
const malformedXML_message = 'This happens when the user sends malformed xml (xml that doesn\'t conform to the published xsd) for the configuration. The error message is, "The XML you provided was not well-formed or did not validate against our published schema."';
async function assert_throws_async(promise, expected_code = 'AccessDenied', expected_message = 'Access Denied') {
    try {
        await promise;
        assert.fail('Test was suppose to fail on ' + expected_message);
    } catch (err) {
        if (err.message !== expected_message || err.code !== expected_code) throw err;
    }
}
mocha.describe('s3 worm', function() {
    const { rpc_client, EMAIL } = coretest;
    const BKT = 'wormbucket';
    const BKT1 = 'wormbucket1';
    const OBJ1 = 'text-file1';
    const OBJ2 = 'text-file2';
    const OBJ3 = 'text-file3';
    const OBJ4 = 'text-file4';
    const file_body = "TEXT-FILE-YAY!!!!-SO_COOL";
    const file_body2 = "TEXT-FILE-YAY!!!!-SO_COOL2";
    let version_id1;
    let version_id2;
    let version_id3;
    let version_id4;
    const user_a = 'alice';
    let s3_owner;
    //let s3_a;
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const s3_creds = {
            endpoint: coretest.get_http_address(),
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            computeChecksums: true,
            s3DisableBodySigning: false,
            region: 'us-east-1',
            httpOptions: { agent: new http.Agent({ keepAlive: false }) },
        };
        const account = { has_login: false, s3_access: true };
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        account.name = user_a;
        account.email = user_a;
        const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
        s3_creds.accessKeyId = user_a_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = user_a_keys[0].secret_key.unwrap();
        //s3_a = new AWS.S3(s3_creds);
        s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
        s3_owner = new AWS.S3(s3_creds);
    });
    mocha.describe('buckets creation', function() {
        mocha.it('create bucket BKT & enable lock', async function() {
            const res = await s3_owner.createBucket({ Bucket: BKT, ObjectLockEnabledForBucket: true }).promise();
            assert.equal(res.Location, `/${BKT}`);
        });
        mocha.it('create bucket BKT1 & enable lock', async function() {
            const res = await s3_owner.createBucket({ Bucket: BKT1, ObjectLockEnabledForBucket: true }).promise();
            assert.equal(res.Location, `/${BKT1}`);
        });
        mocha.it('list buckets with BKT & BKT1', async function() {
            const res = await s3_owner.listBuckets().promise();
            assert(res.Buckets.find(bucket => bucket.Name === BKT));
            assert(res.Buckets.find(bucket => bucket.Name === BKT1));
        });
        mocha.it('should fail suspend versioning on locked bucket', async function() {
            await assert_throws_async(s3_owner.putBucketVersioning({
                Bucket: BKT,
                VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' }
            }).promise(), 'InvalidBucketState', 'The request is not valid with the current state of the bucket.');
        });
    });
    mocha.describe('object OBJ1 creation before having lock config on BKT', function() {
        mocha.it('create object OBJ1 in BKT', async function() {
            const put_object_res = await s3_owner.putObject({ Bucket: BKT, Key: OBJ1, Body: file_body, ContentType: 'text/plain' }).promise();
            version_id1 = put_object_res.VersionId;
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('IT6. should list objects in BKT', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT }).promise();
            assert(res.Contents.find(object => object.Key === OBJ1));
        });
    });
    mocha.describe('bucket object lock configuration on BKT', function() {
        mocha.it('should fail put lock configuration with boch days and years', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Years: 1, Days: 15, Mode: 'COMPLIANCE' } }
                }
            }).promise(), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should fail put lock configuration with 0 years', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Years: 0, Mode: 'GOVERNANCE' } }
                }
            }).promise(), 'InvalidArgument', 'Default retention period must be a positive integer value');
        });
        mocha.it('should fail put faulty lock configuration', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Days: 1, Mode: 'GOVERNANCE1' } }
                }
            }).promise(), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should get empty lock configuration', async function() {
            const conf = await s3_owner.getObjectLockConfiguration({ Bucket: BKT }).promise();
            assert.equal(conf.ObjectLockEnabled, 'Enabled');
            assert.strictEqual(conf.ObjectLockConfiguration.Rule, undefined);
        });
        mocha.it('should fail put lock configuration with disabled lock', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Disabled',
                    Rule: { DefaultRetention: { Days: 15, Mode: 'COMPLIANCE' } }
                }
            }).promise(), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should put lock configuration', async function() {
            const conf = await s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Days: 15, Mode: 'COMPLIANCE' } }
                }
            }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('should get non empty lock configuration', async function() {
            const conf = await s3_owner.getObjectLockConfiguration({ Bucket: BKT }).promise();
            assert.ok(conf.ObjectLockConfiguration.Rule.DefaultRetention);
            assert.strictEqual(conf.ObjectLockConfiguration.Rule.DefaultRetention.Mode, 'COMPLIANCE');
            assert.strictEqual(conf.ObjectLockConfiguration.Rule.DefaultRetention.Days, 15);
        });
    });
    mocha.describe('OBJ1 checks', function() {
        mocha.it('should head object without default values of the BKT conf', async function() {
            const conf = await s3_owner.headObject({ Bucket: BKT, Key: OBJ1 }).promise();
            assert.ok(!conf.ObjectLockLegalHoldStatus && !conf.ObjectLockRetainUntilDate && !conf.ObjectLockMode);
        });
        mocha.it('should put legal hold', async function() {
            const conf = await s3_owner.putObjectLegalHold({
                Bucket: BKT,
                Key: OBJ1,
                LegalHold: {
                    Status: 'ON'
                },
                VersionId: version_id1,
            }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('should get object with legal hold', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 }).promise();
            assert.equal(conf.LegalHold.Status, 'ON');
        });
        const today2 = new Date();
        const MinusOneMin = new Date(today2);
        MinusOneMin.setMinutes(MinusOneMin.getMinutes() - 1);
        mocha.it('should fail put retention at the past', async function() {
            await assert_throws_async(s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                Retention: {
                    Mode: 'GOVERNANCE',
                    RetainUntilDate: MinusOneMin,
                },
                VersionId: version_id1
            }).promise(), 'InvalidArgument', 'The retain until date must be in the future!');
        });
        mocha.it('should put retention', async function() {
            const today1 = new Date();
            const oneSec = new Date(today1);
            oneSec.setSeconds(today1.getSeconds() + 10);
            const conf = await s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                Retention: { Mode: 'GOVERNANCE', RetainUntilDate: oneSec },
                VersionId: version_id1
            }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('should get retention 1', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 }).promise();
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'GOVERNANCE');
        });
        mocha.it('should put retention', async function() {
            const conf = await s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                Retention: { Mode: 'GOVERNANCE', RetainUntilDate: tomorrow },
                VersionId: version_id1
            }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('should get retention 2', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 }).promise();
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'GOVERNANCE');
        });
        mocha.it('should get legal hold (check if legal hold overridden)', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 }).promise();
            assert.equal(conf.LegalHold.Status, 'ON');
        });
        mocha.it('should put retention (compliance mode)', async function() {
            const today3 = new Date();
            const oneSec3 = new Date(today3);
            oneSec3.setSeconds(oneSec3.getSeconds() + 30);
            await assert_throws_async(s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: false,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: oneSec3 },
                VersionId: version_id1
            }).promise(), 'AccessDenied', 'Access Denied');
            const conf = await s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: oneSec3 },
                VersionId: version_id1
            }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('IT25. should get object with retention (compliance mode)', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 }).promise();
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'COMPLIANCE');
        });
        mocha.it('fail delete object with retention COMPLIANCE', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                VersionId: version_id1,
            }).promise(), 'AccessDenied', 'Access Denied');
        });
        mocha.it('put object with retention mode and without date', async function() {
            const params = { Bucket: BKT, Key: OBJ1, Body: file_body, ContentType: 'text/plain', ObjectLockMode: 'GOVERNANCE' };
            await assert_throws_async(s3_owner.putObject(params).promise(), 'InvalidArgument',
                'x-amz-object-lock-retain-until-date and x-amz-object-lock-mode must both be supplied');
        });
    });
    mocha.describe('put object OBJ3 after bucket configuration exist', function() {
        mocha.it('should create object OBJ3 in BKT', async function() {
            const conf = await s3_owner.putObject({ Bucket: BKT, Key: OBJ3, Body: file_body, ContentType: 'text/plain' }).promise();
            assert.ok(conf.VersionId);
            version_id3 = conf.VersionId;
        });
        mocha.it('should list objects in BKT contains OBJ3', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT }).promise();
            assert(res.Contents.find(object => object.Key === OBJ3));
        });
        mocha.it('should fail get slegal hold', async function() {
            await assert_throws_async(s3_owner.getObjectLegalHold({
                Bucket: BKT,
                Key: OBJ3,
                VersionId: version_id3
            }).promise(), 'InvalidRequest', 'SOAP requests must be made over an HTTPS connection.');
        });
        mocha.it('should put legal hold on OBJ3', async function() {
            const conf = await s3_owner.putObjectLegalHold({ Bucket: BKT, Key: OBJ3, LegalHold: { Status: 'OFF' } }).promise();
            assert.deepEqual(conf, {});
        });
        mocha.it('should get object', async function() {
            const conf = await s3_owner.getObject({ Bucket: BKT, Key: OBJ3 }).promise();
            assert.ok(conf.ObjectLockRetainUntilDate);
            assert.strictEqual(conf.ObjectLockMode, 'COMPLIANCE');
        });
        mocha.it('should head object', async function() {
            const conf = await s3_owner.headObject({ Bucket: BKT, Key: OBJ3 }).promise();
            assert.equal(conf.ObjectLockLegalHoldStatus, 'OFF');
            assert.ok(conf.ObjectLockRetainUntilDate);
            assert.strictEqual(conf.ObjectLockMode, 'COMPLIANCE');
        });
        mocha.it('should fail put retention (compliance mode)', async function() {
            await assert_throws_async(s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ3,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: tomorrow },
                VersionId: version_id3,
            }).promise(), 'AccessDenied', 'Access Denied');
        });
    });
    mocha.describe('put object', function() {
        mocha.it('IT26. should put object with retention', async function() {
            const put_object_res = await s3_owner.putObject({
                Bucket: BKT,
                Key: OBJ4,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockLegalHoldStatus: 'OFF',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow,
            }).promise();
            version_id4 = put_object_res.VersionId;
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('should list objects in BKT contains OBJ4', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT }).promise();
            assert(res.Contents.find(object => object.Key === OBJ4));
        });
        mocha.it('should get retention', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ4, VersionId: version_id4 }).promise();
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'GOVERNANCE');
        });
        mocha.it('should get LegalHold', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ4, VersionId: version_id4 }).promise();
            assert.equal(conf.LegalHold.Status, 'OFF');
        });
        mocha.it('should fail delete object with retention (governanceBypass=false)', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ4,
                BypassGovernanceRetention: false,
                VersionId: version_id4,
            }).promise(), 'AccessDenied', 'Access Denied');
        });
        mocha.it('should delete object with retention (governanceBypass=trues)', async function() {
            const deleted = await s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ4,
                BypassGovernanceRetention: true,
                VersionId: version_id4,
            }).promise();
            assert.ok(deleted.VersionId);
        });
    });
    mocha.describe('overwrite versions and check', function() {
        mocha.it('should create object OBJs in BKT', async function() {
            const conf = await s3_owner.putObject({ Bucket: BKT1, Key: OBJ2, Body: file_body, ContentType: 'text/plain' }).promise();
            assert.ok(conf.VersionId);
            version_id2 = conf.VersionId;
        });
        mocha.it('should head object', async function() { //get object version2 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 }).promise();
            assert.ok(!conf.ObjectLockLegalHoldStatus && !conf.ObjectLockRetainUntilDate && !conf.ObjectLockMode);
        });
        mocha.it('IT29. should not overwrite object with retention', async function() {
            const put_object_res = await s3_owner.putObject({ // now version5 is latest
                Bucket: BKT1,
                Key: OBJ2,
                Body: file_body2,
                ContentType: 'text/plain',
            }).promise();
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('should put legal hold on OBJ2', async function() {
            await s3_owner.putObjectLegalHold({ Bucket: BKT1, Key: OBJ2, LegalHold: { Status: 'ON' } }).promise();
        });
        mocha.it('should put retention', async function() {
            await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                Retention: { Mode: 'GOVERNANCE', RetainUntilDate: tomorrow },
            }).promise();
        });
        mocha.it('should head object', async function() { //get object version5 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 }).promise();
            assert.ok(conf.ObjectLockLegalHoldStatus);
            assert.ok(conf.ObjectLockRetainUntilDate);
            assert.strictEqual(conf.ObjectLockMode, 'GOVERNANCE');
        });
        mocha.it('should get legal hold on OBJ2', async function() {
            await assert_throws_async(s3_owner.getObjectLegalHold({
                Bucket: BKT1,
                Key: OBJ2,
                VersionId: version_id2
            }).promise(), 'InvalidRequest', 'SOAP requests must be made over an HTTPS connection.');
        });
        mocha.it('should get retention on OBJ2', async function() {
            await assert_throws_async(s3_owner.getObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                VersionId: version_id2
            }).promise(), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
        });
        mocha.it('should put legal hold on OBJ2 version_id', async function() {
            await s3_owner.putObjectLegalHold({ Bucket: BKT1, Key: OBJ2, LegalHold: { Status: 'OFF' }, VersionId: version_id2 }).promise();
        });
        mocha.it('should put retention (compliance mode) version_id', async function() {
            await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: tomorrow },
                VersionId: version_id2
            }).promise();
        });
        mocha.it('should head object', async function() { //get object version5 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 }).promise();
            assert.strictEqual(conf.ObjectLockLegalHoldStatus, 'ON');
            assert.strictEqual(conf.ObjectLockMode, 'GOVERNANCE');
        });
    });
});
