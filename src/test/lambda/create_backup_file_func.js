/* Copyright (C) 2016 NooBaa */
'use strict';

var AWS = require('aws-sdk');

exports.handler = function(event, context, callback) {
    var srcBucket = event.Records[0].s3.bucket.name;
    var key = event.Records[0].s3.object.key;
    var s3 = new AWS.S3();

    s3.headObject({
            Bucket: srcBucket,
            Key: key
        })
        .promise()
        .then(head => s3.putObject({
                Bucket: srcBucket,
                Key: key + '.json',
                ContentType: 'text/json',
                Body: JSON.stringify({ event, head }, null, 4),
            })
            .promise()
        )
        .then(() => callback(null))
        .catch(err => callback(err));
};
