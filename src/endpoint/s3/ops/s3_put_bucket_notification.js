/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
const notif_util = require('../../../util/notifications_util');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
 */
async function put_bucket_notification(req) {

    let topic_configuration = req.body.NotificationConfiguration?.TopicConfiguration;

    //adapt to db shcema
    if (topic_configuration) {
        for (const conf of topic_configuration) {
            conf.id = conf.Id;
            conf.event = conf.Event;
            conf.topic = conf.Topic;
            delete conf.Id;
            delete conf.Event;
            delete conf.Topic;
        }
    } else {
        topic_configuration = [];
    }

    //test new notifications.
    //if test notification fails, fail the put op
    const err = await notif_util.test_notifications(topic_configuration,
        req.object_sdk.nsfs_config_root, req);

    if (err) {
        let message = "Test notification failed: " + (err.message || err.code);
        //if there's an aggregated error, it will probably have more details in its message
        if (err.name === 'AggregateError' && err.errors && err.errors[0]) {
            const aggregated = err.errors[0];
            message += "," + aggregated.message;
        }
        //for some reason in scale we are not allowed to show the config directory name in user's output
        if (req.object_sdk.nsfs_config_root) {
            message = message.replaceAll(req.object_sdk.nsfs_config_root, "");
        }
        throw new S3Error({
            code: 'InvalidArgument',
            message,
            http_code: 400,
            detail: err.toString()
        });
    }

    const reply = await req.object_sdk.put_bucket_notification({
        bucket_name: req.params.bucket,
        notifications: topic_configuration
    });

    return reply;
}

module.exports = {
    handler: put_bucket_notification,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
