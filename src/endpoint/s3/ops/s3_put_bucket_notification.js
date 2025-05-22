/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
const notif_util = require('../../../util/notifications_util');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
 */
async function put_bucket_notification(req) {

    let topic_configuration = req.body.NotificationConfiguration?.TopicConfiguration;
    const default_connection = req.object_sdk.requesting_account.default_connection;

    //adapt to db shcema
    if (topic_configuration) {
        for (const conf of topic_configuration) {
            conf.id = conf.Id;
            conf.event = conf.Event;
            conf.topic = conf.Topic;
            //handle Kafka's topic synax, if present
            if (conf.Topic && conf.Topic.length > 0 && conf.Topic[0].startsWith('kafka:::topic/')) {
                //kafka_topic_parts is, by index:
                //kafka_topic_parts[0] = 'kafka:::topic'
                //kafka_topic_parts[1] = connection, optional
                //kafka_topic_parts[2] = Kafka topic, mandatory
                const kafka_topic_parts = conf.Topic[0].split('/');
                if (kafka_topic_parts.length !== 3) {
                    throw new S3Error({
                        code: 'InvalidArgument',
                        message: "kafka:::topic is invalid. Must be of syntax: kafka:::topic:/connection/topic",
                        http_code: 400,
                        detail: conf.Topic[0]
                    });
                }
                //connection is optionally kafka_topic_parts[1], default to account's default_connection
                let connection = default_connection;
                if (typeof kafka_topic_parts[1] === 'string' && kafka_topic_parts[1].length > 0) {
                    connection = kafka_topic_parts[1];
                }
                const topic = kafka_topic_parts[2];
                //write the full Topic string with the connection
                conf.topic = ['kafka:::topic/' + connection + "/" + topic];
            }
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
