/* Copyright (C) 2022 NooBaa */
'use strict';

const assert = require('assert');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const commonTests = require('../lifecycle/common');

// expected inputs
assert(process.env.AWS_BUCKET, "Please set AWS_BUCKET env. variable, example 'first.bucket'");
assert(process.env.AWS_ENDPOINT, "Please set AWS_ENDPOINT env. variable, example 'https://s3.amazonaws.com/'");
assert(process.env.AWS_ACCESS_KEY_ID, "Please set AWS_ACCESS_KEY_ID env. variable, example 'XXXXXXXXXXXXXXXXXXXX'");
assert(process.env.AWS_SECRET_ACCESS_KEY, "Please set AWS_SECRET_ACCESS_KEY env. variable, example 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'");

const s3 = new AWS.S3({
    endpoint: process.env.AWS_ENDPOINT, // 'https://s3.amazonaws.com/',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

async function main() {
    const buckets = await s3.listBuckets().promise();
    console.log('buckets', buckets);
    assert(buckets.Buckets);
    const Bucket = process.env.AWS_BUCKET;
    assert(buckets.Buckets.find(element => element.Name === Bucket));

    const Key = `test-get-lifecycle-object-${Date.now()}`;
    const TagName = 'tagname';
    const TagValue = 'tagvalue';
    const TagName2 = "tagname2";
    const TagValue2 = "tagvalue2";
    const ObjectSize = 1024 * 16;
    const Body = crypto.randomBytes(ObjectSize);
    const putObjectParams = {
        Bucket,
        Key,
        Body,
    };

    const putObjectResult = await s3.putObject(putObjectParams).promise();
    console.log('put object params:', putObjectParams, 'result', putObjectResult);
    assert(putObjectResult.ETag);

    await commonTests.test_rules_length(Bucket, Key, s3);
    await commonTests.test_expiration_marker(Bucket, Key, s3);
    await commonTests.test_expiration_date(Bucket, Key, s3);
    await commonTests.test_rule_status(Bucket, Key, s3);
    await commonTests.test_rule_filter(Bucket, Key, s3);
    await commonTests.test_expiration_days(Bucket, Key, s3);
    await commonTests.test_filter_tag(Bucket, TagName, TagValue, s3);
    await commonTests.test_and_tag(Bucket, TagName, TagValue, TagName2, TagValue2, s3);
    await commonTests.test_and_tag_prefix(Bucket, Key, TagName, TagValue, TagName2, TagValue2, s3);
    await commonTests.test_rule_id(Bucket, Key, s3);
    await commonTests.test_empty_filter(Bucket, s3);
    await commonTests.test_filter_size(Bucket, s3);
    await commonTests.test_and_prefix_size(Bucket, Key, s3);

    const getObjectParams = {
        Bucket,
        Key,
    };
    const getObjectResult = await s3.getObject(getObjectParams).promise();
    const getObjectEtag = getObjectResult.ETag;
    console.log("get object result", getObjectResult, "ETag", getObjectEtag);

    // clean up
    await s3.deleteObject({
        Bucket,
        Key
    }).promise();
    console.log('delete test object key', Key);
    console.log('✅ The test was completed successfully');
}

if (require.main === module) {
    main();
}
