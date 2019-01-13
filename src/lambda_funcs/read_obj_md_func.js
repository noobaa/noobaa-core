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
    try {
        const s3 = new AWS.S3();
        const bucket = event.Records[0].s3.bucket.name;
        const key = event.Records[0].s3.object.key;
        const r = await s3.headObject({
            Bucket: bucket,
            Key: key,
        }).promise();
        return callback(null, JSON.stringify(r));
    } catch (err) {
        return callback(err);
    }
};
