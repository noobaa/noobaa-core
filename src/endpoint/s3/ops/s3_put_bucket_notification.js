/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
 */
async function put_bucket_notification(req) {
    
    const topic_configuration = req.body.NotificationConfiguration?.TopicConfiguration;
    if (!topic_configuration || 
        typeof topic_configuration !== 'object') throw new S3Error(S3Error.MalformedXML);


    //align request aws s3api sends
    for(const notif of topic_configuration) {
        if (Array.isArray(notif.Id)) notif.Id = notif.Id[0];
        notif.Connect = Array.isArray(notif.Topic) ? notif.Topic[0] : notif.Topic;
        notif.Events = notif.Event;
        delete notif.Event;
        delete notif.Topic;
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
