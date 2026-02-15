/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const {require_coretest, is_nc_coretest, TMP_PATH} = require('../../../system_tests/test_utils');
const coretest = require_coretest();
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');
const path = require('path');
const fs_utils = require('../../../../util/fs_utils');
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const todayPlus15 = new Date(today);
todayPlus15.setDate(todayPlus15.getDate() + 15);
const malformedXML_message = "The XML you provided was not well-formed or did not validate against our published schema.";
async function assert_throws_async(promise, expected_code = 'AccessDenied', expected_message = 'Access Denied') {
    try {
        await promise;
        assert.fail('Test was suppose to fail on ' + expected_message);
    } catch (err) {
        const actual_code = err.Code || err.code || err.name;
        if (err.message !== expected_message || actual_code !== expected_code) throw err;
    }
}
// eslint-disable-next-line max-lines-per-function
mocha.describe('s3 worm', function() {
    const { rpc_client, EMAIL } = coretest;
    const tmp_fs_root = path.join(TMP_PATH, 'test_s3_worm');
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
    const user_a = 'alicia';
    let s3_owner;
    //let s3_a;
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const s3_creds = {
            endpoint: coretest.get_http_address(),
            forcePathStyle: true,
            // signatureVersion is Deprecated in SDK v3
            //signatureVersion: 'v4',
            // automatically compute the MD5 checksums for of the request payload in SDKV3
            //computeChecksums: true,
            //  s3DisableBodySigning renamed to applyChecksum but can be assigned in S3 object but cant find
            s3DisableBodySigning: false,
            region: 'us-east-1',
            credentials: {},
            requestHandler: new NodeHttpHandler({
                    httpsAgent: new http.Agent({ keepAlive: false })
                })
        };
        const account = { has_login: false, s3_access: true };
        if (is_nc_coretest) {
            await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
            account.nsfs_account_config = {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: tmp_fs_root
            };
        }
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        account.name = user_a;
        account.email = user_a;
        const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
        s3_creds.credentials.accessKeyId = user_a_keys[0].access_key.unwrap();
        s3_creds.credentials.secretAccessKey = user_a_keys[0].secret_key.unwrap();
        //s3_a = new AWS.S3(s3_creds);
        s3_creds.credentials.accessKeyId = admin_keys[0].access_key.unwrap();
        s3_creds.credentials.secretAccessKey = admin_keys[0].secret_key.unwrap();
        s3_owner = new S3(s3_creds);
    });
    mocha.describe('buckets creation', function() {
        mocha.it('create bucket BKT & enable lock', async function() {
            const res = await s3_owner.createBucket({ Bucket: BKT, ObjectLockEnabledForBucket: true });
            assert.equal(res.Location, `/${BKT}`);
        });
        mocha.it('create bucket BKT1 & enable lock', async function() {
            const res = await s3_owner.createBucket({ Bucket: BKT1, ObjectLockEnabledForBucket: true });
            assert.equal(res.Location, `/${BKT1}`);
        });
        mocha.it('list buckets with BKT & BKT1', async function() {
            const res = await s3_owner.listBuckets();
            assert(res.Buckets.find(bucket => bucket.Name === BKT));
            assert(res.Buckets.find(bucket => bucket.Name === BKT1));
        });
        mocha.it('should fail suspend versioning on locked bucket', async function() {
            await assert_throws_async(s3_owner.putBucketVersioning({
                Bucket: BKT,
                VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' }
                //TODO nc error message is the correct one
            }), 'InvalidBucketState', is_nc_coretest ? "An Object Lock configuration is present on this bucket, so the versioning state cannot be changed." :
                'The request is not valid with the current state of the bucket.'
            );
        });
    });

    mocha.describe('object OBJ1 creation before having lock config on BKT', function() {
        mocha.it('create object OBJ1 in BKT', async function() {
            const put_object_res = await s3_owner.putObject({ Bucket: BKT, Key: OBJ1, Body: file_body, ContentType: 'text/plain' });
            version_id1 = put_object_res.VersionId;
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('IT6. should list objects in BKT', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT });
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
            }), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should fail put lock configuration with 0 years', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Years: 0, Mode: 'GOVERNANCE' } }
                }
            }), 'InvalidArgument', 'Default retention period must be a positive integer value');
        });
        mocha.it('should fail put faulty lock configuration', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Days: 1, Mode: 'GOVERNANCE1' } }
                }
            }), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should get empty lock configuration', async function() {
            const conf = await s3_owner.getObjectLockConfiguration({ Bucket: BKT });
            assert.equal(conf.ObjectLockConfiguration.ObjectLockEnabled, 'Enabled');
            assert.strictEqual(conf.ObjectLockConfiguration.Rule, undefined);
        });
        mocha.it('should fail put lock configuration with disabled lock', async function() {
            await assert_throws_async(s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Disabled',
                    Rule: { DefaultRetention: { Days: 15, Mode: 'COMPLIANCE' } }
                }
            }), 'MalformedXML', malformedXML_message);
        });
        mocha.it('should put lock configuration with no rule', async function() {
            const res = await s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                }
            });
            delete res.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(res, {});
            const conf = await s3_owner.getObjectLockConfiguration({ Bucket: BKT });
            assert.equal(conf.ObjectLockConfiguration.ObjectLockEnabled, 'Enabled');
            assert.strictEqual(conf.ObjectLockConfiguration.Rule, undefined);
        });
        mocha.it('should put lock configuration', async function() {
            const conf = await s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                    Rule: { DefaultRetention: { Days: 15, Mode: 'COMPLIANCE' } }
                }
            });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('should get non empty lock configuration', async function() {
            const conf = await s3_owner.getObjectLockConfiguration({ Bucket: BKT });
            assert.ok(conf.ObjectLockConfiguration.Rule.DefaultRetention);
            assert.strictEqual(conf.ObjectLockConfiguration.Rule.DefaultRetention.Mode, 'COMPLIANCE');
            assert.strictEqual(conf.ObjectLockConfiguration.Rule.DefaultRetention.Days, 15);
        });
    });
    mocha.describe('OBJ1 checks', function() {
        mocha.it('should head object without default values of the BKT conf', async function() {
            const conf = await s3_owner.headObject({ Bucket: BKT, Key: OBJ1 });
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
            });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('should get object with legal hold', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 });
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
            }), 'InvalidArgument', 'The retain until date must be in the future!');
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
            });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('should get retention 1', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 });
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
            });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('should get retention 2', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 });
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'GOVERNANCE');
        });
        mocha.it('should get legal hold (check if legal hold overridden)', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 });
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
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
            const conf = await s3_owner.putObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: oneSec3 },
                VersionId: version_id1
            });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('IT25. should get object with retention (compliance mode)', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ1, VersionId: version_id1 });
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'COMPLIANCE');
        });
        mocha.it('fail delete object with retention COMPLIANCE', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ1,
                BypassGovernanceRetention: true,
                VersionId: version_id1,
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
        mocha.it('put object with retention mode and without date', async function() {
            const params = { Bucket: BKT, Key: OBJ1, Body: file_body, ContentType: 'text/plain', ObjectLockMode: 'GOVERNANCE' };
            await assert_throws_async(s3_owner.putObject(params), 'InvalidArgument',
                'x-amz-object-lock-retain-until-date and x-amz-object-lock-mode must both be supplied');
        });
    });
    mocha.describe('put object OBJ3 after bucket configuration exist', function() {
        mocha.it('should create object OBJ3 in BKT', async function() {
            const conf = await s3_owner.putObject({ Bucket: BKT, Key: OBJ3, Body: file_body, ContentType: 'text/plain' });
            assert.ok(conf.VersionId);
            version_id3 = conf.VersionId;
        });
        mocha.it('should list objects in BKT contains OBJ3', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT });
            assert(res.Contents.find(object => object.Key === OBJ3));
        });
        mocha.it('should fail get legal hold', async function() {
            if (is_nc_coretest) {
                await assert_throws_async(s3_owner.getObjectLegalHold({
                    Bucket: BKT,
                    Key: OBJ3,
                    VersionId: version_id3
                }), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
            } else {
                //TODO: error should be NoSuchObjectLockConfiguration
                await assert_throws_async(s3_owner.getObjectLegalHold({
                Bucket: BKT,
                Key: OBJ3,
                VersionId: version_id3
            }), 'InvalidRequest', 'SOAP requests must be made over an HTTPS connection.');
            }
        });
        mocha.it('should put legal hold on OBJ3', async function() {
            const conf = await s3_owner.putObjectLegalHold({ Bucket: BKT, Key: OBJ3, LegalHold: { Status: 'OFF' } });
            delete conf.$metadata; // sdk returns metadata we dont care about here
            assert.deepEqual(conf, {});
        });
        mocha.it('should get object', async function() {
            const conf = await s3_owner.getObject({ Bucket: BKT, Key: OBJ3 });
            assert.ok(conf.ObjectLockRetainUntilDate);
            assert.strictEqual(conf.ObjectLockMode, 'COMPLIANCE');
        });
        mocha.it('should head object', async function() {
            const conf = await s3_owner.headObject({ Bucket: BKT, Key: OBJ3 });
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
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
    });
    mocha.describe('put object OBJ4 with retention - should override default values', function() {

        mocha.it('IT26. should put object with retention', async function() {
            const put_object_res = await s3_owner.putObject({
                Bucket: BKT,
                Key: OBJ4,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockLegalHoldStatus: 'OFF',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow,
            });
            version_id4 = put_object_res.VersionId;
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('should list objects in BKT contains OBJ4', async function() {
            const res = await s3_owner.listObjects({ Bucket: BKT });
            assert(res.Contents.find(object => object.Key === OBJ4));
        });
        mocha.it('should get retention', async function() {
            const conf = await s3_owner.getObjectRetention({ Bucket: BKT, Key: OBJ4, VersionId: version_id4 });
            assert.ok(conf.Retention.RetainUntilDate);
            assert.equal(conf.Retention.Mode, 'GOVERNANCE');
        });
        mocha.it('should get LegalHold', async function() {
            const conf = await s3_owner.getObjectLegalHold({ Bucket: BKT, Key: OBJ4, VersionId: version_id4 });
            assert.equal(conf.LegalHold.Status, 'OFF');
        });
        mocha.it('should fail delete object with retention (governanceBypass=false)', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ4,
                BypassGovernanceRetention: false,
                VersionId: version_id4,
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
        mocha.it('should delete object with retention (governanceBypass=trues)', async function() {
            const deleted = await s3_owner.deleteObject({
                Bucket: BKT,
                Key: OBJ4,
                BypassGovernanceRetention: true,
                VersionId: version_id4,
            });
            assert.ok(deleted.VersionId);
        });
    });
    mocha.describe('overwrite versions and check', function() {
        mocha.it('should create object OBJs in BKT', async function() {
            const conf = await s3_owner.putObject({ Bucket: BKT1, Key: OBJ2, Body: file_body, ContentType: 'text/plain' });
            assert.ok(conf.VersionId);
            version_id2 = conf.VersionId;
        });
        mocha.it('should head object', async function() { //get object version2 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 });
            assert.ok(!conf.ObjectLockLegalHoldStatus && !conf.ObjectLockRetainUntilDate && !conf.ObjectLockMode);
        });
        mocha.it('IT29. should not overwrite object with retention', async function() {
            const put_object_res = await s3_owner.putObject({ // now version5 is latest
                Bucket: BKT1,
                Key: OBJ2,
                Body: file_body2,
                ContentType: 'text/plain',
            });
            assert.ok(put_object_res.VersionId);
        });
        mocha.it('should put legal hold on OBJ2', async function() {
            await s3_owner.putObjectLegalHold({ Bucket: BKT1, Key: OBJ2, LegalHold: { Status: 'ON' } });
        });
        mocha.it('should put retention', async function() {
            await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                Retention: { Mode: 'GOVERNANCE', RetainUntilDate: tomorrow },
            });
        });
        mocha.it('should head object', async function() { //get object version5 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 });
            assert.ok(conf.ObjectLockLegalHoldStatus);
            assert.ok(conf.ObjectLockRetainUntilDate);
            assert.strictEqual(conf.ObjectLockMode, 'GOVERNANCE');
        });
        mocha.it('should get legal hold on OBJ2', async function() {
            if (is_nc_coretest) {
                await assert_throws_async(s3_owner.getObjectLegalHold({
                    Bucket: BKT1,
                    Key: OBJ2,
                    VersionId: version_id2
                }), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
            } else {
                await assert_throws_async(s3_owner.getObjectLegalHold({
                    Bucket: BKT1,
                    Key: OBJ2,
                    VersionId: version_id2
                }), 'InvalidRequest', 'SOAP requests must be made over an HTTPS connection.');
            }
        });
        mocha.it('should get retention on OBJ2', async function() {
            await assert_throws_async(s3_owner.getObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                VersionId: version_id2
            }), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
        });
        mocha.it('should put legal hold on OBJ2 version_id', async function() {
            await s3_owner.putObjectLegalHold({ Bucket: BKT1, Key: OBJ2, LegalHold: { Status: 'OFF' }, VersionId: version_id2 });
        });
        mocha.it('should put retention (compliance mode) version_id', async function() {
            await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: OBJ2,
                Retention: { Mode: 'COMPLIANCE', RetainUntilDate: tomorrow },
                VersionId: version_id2
            });
        });
        mocha.it('should head object', async function() { //get object version5 = latest
            const conf = await s3_owner.headObject({ Bucket: BKT1, Key: OBJ2 });
            assert.strictEqual(conf.ObjectLockLegalHoldStatus, 'ON');
            assert.strictEqual(conf.ObjectLockMode, 'GOVERNANCE');
        });
    });

    mocha.describe('delete marker behavior with Object Lock', function() {
        const DELETE_MARKER_KEY = 'delete-marker-test-obj';

        mocha.it('should create object for delete marker test', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: DELETE_MARKER_KEY,
                Body: file_body,
                ContentType: 'text/plain'
            });
            assert.ok(res.VersionId);
        });

        mocha.it('should create delete marker without version ID (simple delete)', async function() {
            const res = await s3_owner.deleteObject({
                Bucket: BKT1,
                Key: DELETE_MARKER_KEY
            });
            assert.ok(res.VersionId);
            assert.ok(res.DeleteMarker);
        });

        mocha.it('should list object versions and find delete marker', async function() {
            const res = await s3_owner.listObjectVersions({ Bucket: BKT1, Prefix: DELETE_MARKER_KEY });
            const marker = res.DeleteMarkers && res.DeleteMarkers.find(m => m.Key === DELETE_MARKER_KEY);
            assert.ok(marker);
        });
    });

    mocha.describe('extend retention period (governance mode)', function() {
        const EXTEND_RETENTION_KEY = 'extend-retention-test';
        let extend_retention_version_id;
        let longerDate;

        mocha.it('should create object with short retention period', async function() {
            const shortDate = new Date();
            shortDate.setDate(shortDate.getDate() + 1);

            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: EXTEND_RETENTION_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: shortDate
            });
            extend_retention_version_id = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should extend retention period to longer date', async function() {
            longerDate = new Date();
            longerDate.setDate(longerDate.getDate() + 5);

            const res = await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: EXTEND_RETENTION_KEY,
                VersionId: extend_retention_version_id,
                Retention: {
                    Mode: 'GOVERNANCE',
                    RetainUntilDate: longerDate
                },
            });
            delete res.$metadata;
            assert.deepEqual(res, {});
        });

        mocha.it('should verify extended retention date', async function() {
            const res = await s3_owner.getObjectRetention({
                Bucket: BKT1,
                Key: EXTEND_RETENTION_KEY,
                VersionId: extend_retention_version_id
            });
            assert.ok(res.Retention.RetainUntilDate);
            // Compare with second-level precision to avoid ms truncation issues
            const actual = Math.floor(new Date(res.Retention.RetainUntilDate).getTime() / 1000);
            const expected = Math.floor(new Date(longerDate).getTime() / 1000);
            assert.strictEqual(actual, expected);
        });
    });

    mocha.describe('legal hold toggle (on/off)', function() {
        const LEGAL_HOLD_TOGGLE_KEY = 'legal-hold-toggle-test';
        let legal_hold_toggle_version_id;

        mocha.it('should create object with legal hold ON', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockLegalHoldStatus: 'ON'
            });
            legal_hold_toggle_version_id = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should verify legal hold is ON', async function() {
            const res = await s3_owner.getObjectLegalHold({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                VersionId: legal_hold_toggle_version_id
            });
            assert.equal(res.LegalHold.Status, 'ON');
        });

        mocha.it('should verify default retention was not applied', async function() {
            await assert_throws_async(s3_owner.getObjectRetention({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                VersionId: legal_hold_toggle_version_id
            }), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
        });

        mocha.it('should toggle legal hold to OFF', async function() {
            const res = await s3_owner.putObjectLegalHold({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                VersionId: legal_hold_toggle_version_id,
                LegalHold: { Status: 'OFF' }
            });
            delete res.$metadata;
            assert.deepEqual(res, {});
        });

        mocha.it('should verify legal hold is now OFF', async function() {
            const res = await s3_owner.getObjectLegalHold({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                VersionId: legal_hold_toggle_version_id
            });
            assert.equal(res.LegalHold.Status, 'OFF');
        });

        mocha.it('should toggle legal hold back to ON', async function() {
            const res = await s3_owner.putObjectLegalHold({
                Bucket: BKT1,
                Key: LEGAL_HOLD_TOGGLE_KEY,
                VersionId: legal_hold_toggle_version_id,
                LegalHold: { Status: 'ON' }
            });
            delete res.$metadata;
            assert.deepEqual(res, {});
        });
    });

    mocha.describe('list object versions with retention', function() {
        const LIST_VERSIONS_KEY = 'list-versions-retention-test';
        let list_versions_id1;
        let list_versions_id2;
        let list_versions_id3;

        mocha.it('should create first version without retention', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: LIST_VERSIONS_KEY,
                Body: file_body,
                ContentType: 'text/plain'
            });
            list_versions_id1 = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should create second version with retention', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: LIST_VERSIONS_KEY,
                Body: file_body2,
                ContentType: 'text/plain',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow
            });
            list_versions_id2 = res.VersionId;
            assert.ok(res.VersionId);
            assert.notEqual(list_versions_id2, list_versions_id1);
        });

        mocha.it('should create third version with different retention', async function() {
            const differentDate = new Date();
            differentDate.setDate(differentDate.getDate() + 30);

            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: LIST_VERSIONS_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockMode: 'COMPLIANCE',
                ObjectLockRetainUntilDate: differentDate
            });
            list_versions_id3 = res.VersionId;
            assert.ok(res.VersionId);
            assert.notEqual(list_versions_id3, list_versions_id2);
        });

        mocha.it('should list all versions of the object', async function() {
            const res = await s3_owner.listObjectVersions({
                Bucket: BKT1,
                Prefix: LIST_VERSIONS_KEY
            });
            assert.ok(res.Versions);
            assert(res.Versions.length >= 3);
            const keys = res.Versions.map(v => v.VersionId);
            assert(keys.includes(list_versions_id1));
            assert(keys.includes(list_versions_id2));
            assert(keys.includes(list_versions_id3));
        });
    });

    mocha.describe('compliance mode restrictions', function() {
        const COMPLIANCE_KEY = 'compliance-mode-test';
        let compliance_version_id;

        mocha.it('should create object with compliance mode retention', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: COMPLIANCE_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockMode: 'COMPLIANCE',
                ObjectLockRetainUntilDate: tomorrow
            });
            compliance_version_id = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should fail to shorten compliance retention period', async function() {
            const shorterDate = new Date();
            shorterDate.setHours(shorterDate.getHours() + 1);

            await assert_throws_async(s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: COMPLIANCE_KEY,
                VersionId: compliance_version_id,
                Retention: {
                    Mode: 'COMPLIANCE',
                    RetainUntilDate: shorterDate
                },
                BypassGovernanceRetention: true
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });

        mocha.it('should allow extending compliance retention period', async function() {
            const longerDate = new Date();
            longerDate.setDate(longerDate.getDate() + 60);

            const res = await s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: COMPLIANCE_KEY,
                VersionId: compliance_version_id,
                Retention: {
                    Mode: 'COMPLIANCE',
                    RetainUntilDate: longerDate
                },
                BypassGovernanceRetention: true
            });
            delete res.$metadata;
            assert.deepEqual(res, {});
        });

        mocha.it('should fail to change compliance mode to governance', async function() {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            await assert_throws_async(s3_owner.putObjectRetention({
                Bucket: BKT1,
                Key: COMPLIANCE_KEY,
                VersionId: compliance_version_id,
                Retention: {
                    Mode: 'GOVERNANCE',
                    RetainUntilDate: futureDate
                },
                BypassGovernanceRetention: true
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
    });

    mocha.describe('legal hold and retention independence', function() {
        const INDEPENDENCE_KEY = 'legal-hold-retention-independence-test';
        let independence_version_id;

        mocha.it('should create object with both legal hold and retention', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: INDEPENDENCE_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockLegalHoldStatus: 'ON',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow
            });
            independence_version_id = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should remove legal hold while retention still active', async function() {
            await s3_owner.putObjectLegalHold({
                Bucket: BKT1,
                Key: INDEPENDENCE_KEY,
                VersionId: independence_version_id,
                LegalHold: { Status: 'OFF' }
            });

            // Verify legal hold is off but retention is still on
            const res = await s3_owner.headObject({
                Bucket: BKT1,
                Key: INDEPENDENCE_KEY,
                VersionId: independence_version_id
            });
            assert.equal(res.ObjectLockLegalHoldStatus, 'OFF');
            assert.ok(res.ObjectLockRetainUntilDate);
        });

        mocha.it('should fail to delete object with active retention even though legal hold is off', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT1,
                Key: INDEPENDENCE_KEY,
                VersionId: independence_version_id,
                BypassGovernanceRetention: false
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
    });

    mocha.describe('multipart upload with object lock', function() {
        const MULTIPART_KEY = 'multipart-upload-lock-test';
        let uploadId;
        let part1ETag;
        let part2ETag;
        let multipart_version_id;

        mocha.it('should initiate multipart upload', async function() {
            const res = await s3_owner.createMultipartUpload({
                Bucket: BKT1,
                Key: MULTIPART_KEY,
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow,
                ObjectLockLegalHoldStatus: 'OFF'
            });
            assert.ok(res.UploadId);
            uploadId = res.UploadId;
        });

        mocha.it('should upload parts', async function() {
            const part1 = file_body;
            const part2 = file_body2;

            const res1 = await s3_owner.uploadPart({
                Bucket: BKT1,
                Key: MULTIPART_KEY,
                UploadId: uploadId,
                PartNumber: 1,
                Body: part1
            });
            assert.ok(res1.ETag);
            part1ETag = res1.ETag;

            const res2 = await s3_owner.uploadPart({
                Bucket: BKT1,
                Key: MULTIPART_KEY,
                UploadId: uploadId,
                PartNumber: 2,
                Body: part2
            });
            assert.ok(res2.ETag);
            part2ETag = res2.ETag;
        });

        mocha.it('should complete multipart upload with retention', async function() {
            const res = await s3_owner.completeMultipartUpload({
                Bucket: BKT1,
                Key: MULTIPART_KEY,
                UploadId: uploadId,
                MultipartUpload: {
                    Parts: [
                        { PartNumber: 1, ETag: part1ETag },
                        { PartNumber: 2, ETag: part2ETag }
                    ]
                }
            });
            assert.ok(res.VersionId);
            multipart_version_id = res.VersionId;
        });

        mocha.it('should verify completed multipart upload has retention', async function() {
            const res = await s3_owner.headObject({
                Bucket: BKT1,
                Key: MULTIPART_KEY,
                VersionId: multipart_version_id
            });
            assert.ok(res.ObjectLockRetainUntilDate);
            assert.equal(res.ObjectLockMode, 'GOVERNANCE');
            assert.equal(res.ObjectLockLegalHoldStatus, 'OFF');
        });
    });

    mocha.describe('object lock with different versions', function() {
        const VERSION_TEST_KEY = 'version-lock-test';
        let version_test_id1;
        let version_test_id2;
        let version_test_id3;

        mocha.it('should create version 1 without lock', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                Body: file_body,
                ContentType: 'text/plain'
            });
            version_test_id1 = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should create version 2 with governance lock', async function() {
            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                Body: file_body2,
                ContentType: 'text/plain',
                ObjectLockMode: 'GOVERNANCE',
                ObjectLockRetainUntilDate: tomorrow
            });
            version_test_id2 = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should create version 3 with compliance lock', async function() {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            const res = await s3_owner.putObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                Body: file_body,
                ContentType: 'text/plain',
                ObjectLockMode: 'COMPLIANCE',
                ObjectLockRetainUntilDate: futureDate
            });
            version_test_id3 = res.VersionId;
            assert.ok(res.VersionId);
        });

        mocha.it('should allow deleting version 1 (no lock)', async function() {
            const res = await s3_owner.deleteObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                VersionId: version_test_id1
            });
            assert.ok(res.VersionId);
        });

        mocha.it('should fail to delete version 2 (governance lock)', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                VersionId: version_test_id2,
                BypassGovernanceRetention: false
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });

        mocha.it('should allow deleting version 2 with bypass governance flag', async function() {
            const res = await s3_owner.deleteObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                VersionId: version_test_id2,
                BypassGovernanceRetention: true
            });
            assert.ok(res.VersionId);
        });

        mocha.it('should fail to delete version 3 (compliance lock) even with bypass flag', async function() {
            await assert_throws_async(s3_owner.deleteObject({
                Bucket: BKT1,
                Key: VERSION_TEST_KEY,
                VersionId: version_test_id3,
                BypassGovernanceRetention: true
            }), 'AccessDenied', is_nc_coretest ? 'Access Denied because object protected by object lock.' : 'Access Denied');
        });
    });

    mocha.describe('should put object in a bucket with object lock enabled and no default retention', function() {
        mocha.it('should create object in bucket', async function() {
            await s3_owner.putObjectLockConfiguration({
                Bucket: BKT,
                ObjectLockConfiguration: {
                    ObjectLockEnabled: 'Enabled',
                }
            });
            const conf = await s3_owner.putObject({ Bucket: BKT, Key: OBJ1, Body: file_body, ContentType: 'text/plain' });
            assert.ok(conf.VersionId);
        });

        mocha.it('should verify no default retention', async function() {
            await assert_throws_async(s3_owner.getObjectRetention({
                Bucket: BKT,
                Key: OBJ1,
            }), 'NoSuchObjectLockConfiguration', 'The specified object does not have a ObjectLock configuration');
        });
    });
});
