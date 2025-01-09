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
        req.object_sdk.nsfs_config_root);
    if (err) {
        throw new S3Error({
            code: 'InvalidArgument',
            message: JSON.stringify(err.message),
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
