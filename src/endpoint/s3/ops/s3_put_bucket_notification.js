/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
 */
async function put_bucket_notification(req) {

    const topic_configuration = req.body.NotificationConfiguration?.TopicConfiguration;
    if (!topic_configuration ||
        typeof topic_configuration !== 'object') throw new S3Error(S3Error.MalformedXML);

    //adapt to db shcema
    for (const conf of topic_configuration) {
        conf.id = conf.Id;
        conf.event = conf.Event;
        conf.topic = conf.Topic;
        delete conf.Id;
        delete conf.Event;
        delete conf.Topic;
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
