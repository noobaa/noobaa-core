/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETnotification.html
 */
async function get_bucket_notification(req) {

    const result = await req.object_sdk.get_bucket_notification({
        bucket_name: req.params.bucket,
    });


    const reply = result.notifications.length > 0 ?
        {
            //return result inside TopicConfiguration tag
            NotificationConfiguration: {
                TopicConfiguration: result.notifications
            }
        } :
        //if there's no notification, reuturn empty NotificationConfiguration tag
        { NotificationConfiguration: {} };

    return reply;
}

module.exports = {
    handler: get_bucket_notification,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
