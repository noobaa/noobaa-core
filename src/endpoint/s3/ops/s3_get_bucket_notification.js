/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETnotification.html
 */
async function get_bucket_notification(req) {

    const result = await req.object_sdk.get_bucket_notification({
        bucket_name: req.params.bucket,
    });

    //adapt to structure that xml_utils.encode_xml() will then
    //encode into aws compliant reply
    return {
        NotificationConfiguration: [_.map(result, t => ({
            TopicConfiguration: [
                {
                    Id: t.id,
                    Topic: t.topic,
                },
                _.map(t.event, e => ({
                    Event: e
                }))
            ]
        }))]
    };
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
