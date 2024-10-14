/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const fs = require('fs');
const path = require('path');

const config = require('../../../config');

// setup coretest first to prepare the env
const { get_coretest_path, TMP_PATH } = require('../system_tests/test_utils');
const coretest_path = get_coretest_path();
const coretest = require(coretest_path);

const { rpc_client, EMAIL, POOL_LIST } = coretest;

console.log('POOL_LIST =', POOL_LIST);

const tmp_path = path.join(TMP_PATH, 'test_notifications');
//dir for connect files
const tmp_connect = path.join(tmp_path, 'connect');
//dir for notification persistent files
const notif_logs_path = path.join(tmp_path, 'notif_logs');
config.NOTIFICATION_LOG_DIR = notif_logs_path;

coretest.setup({pools_to_create: [POOL_LIST[1]]});
const { S3 } = require('@aws-sdk/client-s3');
const mocha = require('mocha');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const assert = require('assert');
const timer = require('node:timers/promises');
const notifications_util = require('../../util/notifications_util');

const http_connect_filename = 'http_connect.json';
const http_connect_path = path.join(tmp_connect, http_connect_filename);
//content of connect file, will be written to a file in before()
const http_connect = {
    agent_request_object: {"host": "localhost", "port": 9999, "timeout": 100},
    request_options_object: {"auth": "amit:passw"},
    notification_protocol: 'http',
    name: 'http_notif'
};

const Bucket = 'notif';

let http_server = null;
let server_done = false;
let expected_bucket;
let expected_event_name;

// eslint-disable-next-line max-lines-per-function
mocha.describe('notifications', function() {

    this.timeout(20000); // eslint-disable-line no-invalid-this

    describe('notifications', () => {

        const s3_creds = {
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: new http.Agent({ keepAlive: false })
            })
        };
        let s3;

        mocha.before(async function() {

            const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
            s3_creds.credentials = {
                accessKeyId: admin_keys[0].access_key.unwrap(),
                secretAccessKey: admin_keys[0].secret_key.unwrap(),
            };
            s3_creds.endpoint = coretest.get_http_address();
            s3 = new S3(s3_creds);

            //create http connect file
            fs.mkdirSync(tmp_connect, {recursive: true});
            fs.writeFileSync(http_connect_path, JSON.stringify(http_connect));

            fs.mkdirSync(notif_logs_path, {recursive: true});

            await s3.createBucket({
                Bucket,
            });

            http_server = http.createServer(async function(req, res) {
                const chunks = [];

                for await (const chunk of req) {
                    chunks.push(chunk);
                }

                const input = Buffer.concat(chunks);
                const notif = JSON.parse(input.toString());

                assert.strictEqual(notif.Records[0].s3.bucket.name, expected_bucket, 'wrong bucket name in notification');
                assert.strictEqual(notif.Records[0].eventName, expected_event_name, 'wrong event name in notification');

                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end();
                server_done = true;
            }).listen(9999);
        });

        mocha.after(() => {
            http_server.close();
        });

        mocha.it('set/get notif conf s3ops', async () => {
            await s3.putBucketNotificationConfiguration({
                Bucket,
                NotificationConfiguration: {
                    TopicConfigurations: [{
                        "Id": "system_test_http_no_event",
                        "TopicArn": http_connect_path,
                    }],
                },
            });

            const get = await s3.getBucketNotificationConfiguration({Bucket});
            assert.strictEqual(get.TopicConfigurations[0].Id, 'system_test_http_no_event');
        });

        mocha.it('simple notif put', async () => {
            await s3.putObject({
                Bucket,
                Key: 'f1',
                Body: 'this is the body',
            });

            await notify_await_result({bucket: Bucket, event_name: 'ObjectCreated:Put'});
        });


        mocha.it('simple notif delete', async () => {
            await s3.deleteObject({
                Bucket,
                Key: 'f1',
            });

            await notify_await_result({bucket: Bucket, event_name: 'ObjectRemoved:Delete'});
        });


        mocha.it('event notif', async () => {

            const set = await s3.putBucketNotificationConfiguration({
                Bucket,
                NotificationConfiguration: {
                    TopicConfigurations: [{
                        "Id": "system_test_http_event",
                        "TopicArn": http_connect_path,
                        "Events": ["s3:ObjectCreated:*"],
                    }],
                },
            });

            assert.strictEqual(set.$metadata.httpStatusCode, 200);

            await s3.putObject({
                Bucket,
                Key: 'f1',
                Body: 'this is the body',
            });

            await notify_await_result({bucket: Bucket, event_name: 'ObjectCreated:Put'});

            await s3.deleteObject({
                Bucket,
                Key: 'f1',
            });

            //there shouldn't be a notification for the delete, wait 2 seconds to validate this
            await notify_await_result({timeout: 2000});
        });
    });

});

const step_wait = 100;
async function notify_await_result({bucket, event_name, timeout}) {

    //remember expected result here so server could compare it to actual result later
    expected_bucket = bucket;
    expected_event_name = event_name;
    server_done = false;

    //busy-sync wait for server
    //eslint-disable-next-line no-unmodified-loop-condition
    while (!server_done) {
        console.log('awaiting for notification to arrive, timeout =', timeout);
        await new notifications_util.Notificator({name: 'coretest notificator'}).process_notification_files();
        await timer.setTimeout(step_wait);
        if (timeout !== undefined) {
            timeout -= step_wait;
            //timeout if we're validating notification did not arrive
            if (timeout < 0) break;
        }
    }

    //if we were not expecting to get a notification (time is undefined),
    //make sure server_done remained false
    assert.strictEqual(timeout === undefined || !server_done, true, "unexpected notification received");
}
