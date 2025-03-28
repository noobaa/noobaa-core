/* Copyright (C) 2025 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const fs = require('fs');
const path = require('path');

const config = require('../../../config');

// setup coretest first to prepare the env
const { get_coretest_path, generate_s3_client, TMP_PATH } = require('../system_tests/test_utils');
const coretest_path = get_coretest_path();
const coretest = require(coretest_path);

const { rpc_client, EMAIL, POOL_LIST } = coretest;

console.log('POOL_LIST =', POOL_LIST);

const tmp_path = path.join(TMP_PATH, 'test_notifications');
//dir for connect files
const tmp_connect = path.join(tmp_path, 'connect');
//dir for notification persistent files
const notif_logs_path = path.join(tmp_path, 'notif_logs');

coretest.setup({pools_to_create: [POOL_LIST[1]]});
const mocha = require('mocha');
const http = require('http');
const assert = require('assert');
const timer = require('node:timers/promises');
const notifications_util = require('../../util/notifications_util');

const http_connect_filename = 'http_connect.json';
const http_connect_path = path.join(tmp_connect, http_connect_filename);
//content of connect file, will be written to a file in before()
const http_connect = {
    agent_request_object: {"host": "localhost", "port": 9998, "timeout": 1500},
    request_options_object: {"auth": "amit:passw", "timeout": 1500},
    notification_protocol: 'http',
    name: 'http_notif'
};

const bucket = 'bucket-notif';

config.NOTIFICATION_LOG_DIR = notif_logs_path;
config.NOTIFICATION_CONNECT_DIR = tmp_connect;

//an http server that will receive the notification
let http_server = null;
//has server finished handling the notification?
let server_done = false;
let expected_bucket;
let expected_event_name;
let expected_key;
let expected_eTag;

// eslint-disable-next-line max-lines-per-function
mocha.describe('notifications', function() {

    this.timeout(40000); // eslint-disable-line no-invalid-this
    let s3;

    describe('notifications', () => {

        mocha.before(async function() {

            const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
            s3 = generate_s3_client(admin_keys[0].access_key.unwrap(),
                admin_keys[0].secret_key.unwrap(),
                coretest.get_http_address());

            //create http connect file
            fs.mkdirSync(tmp_connect, {recursive: true});
            fs.writeFileSync(http_connect_path, JSON.stringify(http_connect));

            fs.mkdirSync(notif_logs_path, {recursive: true});

            await s3.createBucket({
                Bucket: bucket,
            });

            http_server = http.createServer(async function(req, res) {
                const chunks = [];

                for await (const chunk of req) {
                    chunks.push(chunk);
                }

                const input = Buffer.concat(chunks);
                const notif = JSON.parse(input.toString());

                if (notif !== "test notification") {
                    assert.strictEqual(notif.Records[0].s3.bucket.name, expected_bucket, 'wrong bucket name in notification');
                    assert.strictEqual(notif.Records[0].eventName, expected_event_name, 'wrong event name in notification');
                    assert.strictEqual(notif.Records[0].s3.object.key, expected_key, 'wrong key in notification');
                    const expected_eTag_trimmed = expected_eTag && expected_eTag.substring(1, expected_eTag.length - 1);
                    assert.strictEqual(notif.Records[0].s3.object.eTag, expected_eTag_trimmed, 'wrong eTag in notification');
                }
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end();
                server_done = true;
            }).listen(9998);
        });

        mocha.after(() => {
            http_server.close();
        });

        mocha.it('set/get notif conf s3ops', async () => {
            await s3.putBucketNotificationConfiguration({
                Bucket: bucket,
                NotificationConfiguration: {
                    TopicConfigurations: [{
                        "Id": "system_test_http_no_event",
                        "TopicArn": http_connect_filename,
                    }],
                },
            });

            const get = await s3.getBucketNotificationConfiguration({Bucket: bucket});
            assert.strictEqual(get.TopicConfigurations[0].Id, 'system_test_http_no_event');
        });

        mocha.it('simple notif put', async () => {
            const res = await s3.putObject({
                Bucket: bucket,
                Key: 'f1',
                Body: 'this is the body',
            });

            await notify_await_result({
                bucket_name: bucket,
                event_name: 'ObjectCreated:Put',
                key: "f1",
                etag: res.ETag
            });
        });


        mocha.it('simple notif delete', async () => {
            await s3.deleteObject({
                Bucket: bucket,
                Key: 'f1',
            });

            await notify_await_result({
                bucket_name: bucket,
                event_name: 'ObjectRemoved:Delete',
                key: "f1",
                etag: undefined
            });
        });


        mocha.it('notifications with event filtering', async () => {

            const set = await s3.putBucketNotificationConfiguration({
                Bucket: bucket,
                NotificationConfiguration: {
                    TopicConfigurations: [{
                        "Id": "system_test_http_event",
                        "TopicArn": http_connect_filename,
                        "Events": ["s3:ObjectCreated:*"],
                    }],
                },
            });

            assert.strictEqual(set.$metadata.httpStatusCode, 200);

            const res = await s3.putObject({
                Bucket: bucket,
                Key: 'f2',
                Body: 'this is the body',
            });

            await notify_await_result({
                bucket_name: bucket,
                event_name: 'ObjectCreated:Put',
                key: "f2",
                etag: res.ETag
            });

            await s3.deleteObject({
                Bucket: bucket,
                Key: 'f2',
            });

            //there shouldn't be a notification for the delete, wait 2 seconds to validate this
            await notify_await_result({timeout: 2000});
        });

        mocha.it('multipart', async () => {
            const res_create = await s3.createMultipartUpload({
                Bucket: bucket,
                Key: 'mp1'
            });

            const res_upload = await s3.uploadPart({
                Bucket: bucket,
                Key: 'mp1',
                UploadId: res_create.UploadId,
                PartNumber: 1,
                Body: 'this is the body'
            });

            const res_complete = await s3.completeMultipartUpload({
                Bucket: bucket,
                Key: 'mp1',
                UploadId: res_create.UploadId,
                MultipartUpload: {
                    Parts: [{
                        ETag: res_upload.ETag,
                        PartNumber: 1
                    }]
                }
            });

            await notify_await_result({
                bucket_name: bucket,
                event_name: 'ObjectCreated:CompleteMultipartUpload',
                key: "mp1",
                etag: res_complete.ETag
            });
        });

    });

});

const step_wait = 100;
async function notify_await_result({bucket_name, event_name, etag, key, timeout = undefined}) {

    //remember expected result here so server could compare it to actual result later
    expected_bucket = bucket_name;
    expected_event_name = event_name;
    expected_eTag = etag;
    expected_key = key;
    server_done = false;

    //busy-sync wait for server
    //eslint-disable-next-line no-unmodified-loop-condition
    while (!server_done) {
        console.log('awaiting for notification to arrive, timeout =', timeout);
        await new notifications_util.Notificator({
            name: 'coretest notificator',
            connect_files_dir: tmp_connect,
        }).process_notification_files();
        await timer.setTimeout(step_wait);
        if (timeout !== undefined) {
            timeout -= step_wait;
            //timeout if we're validating notification did not arrive
            if (timeout < 0) break;
        }
    }

    //if we were not expecting to get a notification (timeout is undefined),
    //make sure server_done remained false
    assert.strictEqual(timeout === undefined || !server_done, true, "unexpected notification received");
    assert.strictEqual(fs.readdirSync(notif_logs_path).length, 0, "notif log dir is not empty.");
}
