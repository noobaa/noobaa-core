/* Copyright (C) 2016 NooBaa */
'use strict';

var AWS = require('aws-sdk');

exports.handler = function(event, context, callback) {
    var srcBucket = event.Records[0].s3.bucket.name;
    var key = event.Records[0].s3.object.key;
    var s3 = new AWS.S3();

    s3.deleteObject({
            Bucket: srcBucket,
            Key: key + '.json',
        })
        .promise()
        .then(() => callback(null))
        .catch(err => callback(err));
};
