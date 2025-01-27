/* Copyright (C) 2016 NooBaa */
'use strict';

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
