/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');

exports.handler = function(event, context, callback) {
    const srcBucket = event.Records[0].s3.bucket.name;
    const key = event.Records[0].s3.object.key;
    const s3 = new AWS.S3();

    s3.deleteObject({
            Bucket: srcBucket,
            Key: key + '.json',
        })
        .promise()
        .then(() => callback(null))
        .catch(err => callback(err));
};
