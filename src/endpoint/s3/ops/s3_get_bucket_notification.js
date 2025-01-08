/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETnotification.html
 */
async function get_bucket_notification(req) {

    let result = await req.object_sdk.get_bucket_notification({
        bucket_name: req.params.bucket,
    });

    result = _.cloneDeep(result);

    const TopicConfiguration = [];

    //adapt to aws cli structure
    if (result && result.length > 0) {
        for (const conf of result) {
            conf.Event = conf.event;
            conf.Topic = conf.topic;
            conf.Id = conf.id;
            delete conf.event;
            delete conf.topic;
            delete conf.id;

            TopicConfiguration.push({TopicConfiguration: conf});
        }
    }

    if (result && result.length > 0) {
        for (const conf of result) {
            TopicConfiguration.push({TopicConfiguration: conf});
        }
    }

    const reply = result && result.length > 0 ?
        {
            //return result inside TopicConfiguration tag
            NotificationConfiguration:
                TopicConfiguration
        } :
        //if there's no notification, return empty NotificationConfiguration tag
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
