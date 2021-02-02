/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event - trigger structure:
{
    "Records": [{
        "s3": {
            "bucket": { "name": "first.bucket" },
            "object": { "key": "Apple.jpg" }
        }
    }]
}
*/

const AWS = require('aws-sdk');

exports.handler = async function(event, context, callback) {
    const srcBucket = event.Records[0].s3.bucket.name;
    const key = event.Records[0].s3.object.key;
    const s3 = new AWS.S3();

    try {
        const head = await s3.headObject({
                Bucket: srcBucket,
                Key: key
            })
            .promise();
        await s3.putObject({
                Bucket: srcBucket,
                Key: key + '.json',
                ContentType: 'text/json',
                Body: JSON.stringify({ event, head }, null, 4),
            })
            .promise();
        return callback(null);
    } catch (err) {
        return callback(err);
    }
};
