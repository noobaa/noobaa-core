/* Copyright (C) 2016 NooBaa */
'use strict';

const assert = require('assert');
const AWS = require('aws-sdk');
const crypto = require('crypto');

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

    const Key = `test-get-object-part-${Date.now()}`;
    const Bucket = process.env.AWS_BUCKET;
    const part_size = 1024 * 1024 * 16;
    const part1_range_expected = `bytes 0-${part_size - 1}/${part_size * 2}`;
    // eslint-disable-next-line no-mixed-operators
    const part2_range_expected = `bytes ${part_size}-${part_size * 2 - 1}/${part_size * 2}`;


    const mp_init = await s3.createMultipartUpload({
        Bucket,
        Key,
    }).promise();

    const UploadId = mp_init.UploadId;
    assert(UploadId);
    console.log('created multipart upload', mp_init);

    // upload 2 parts
    const body1 = crypto.randomBytes(part_size);
    const upload_part1 = await s3.uploadPart({
        Bucket,
        Key,
        UploadId,
        Body: body1,
        PartNumber: 1
    }).promise();
    assert(upload_part1.ETag);
    console.log('uploaded part 1', upload_part1);

    const body2 = crypto.randomBytes(part_size);
    const upload_part2 = await s3.uploadPart({
        Bucket,
        Key,
        UploadId,
        Body: body2,
        PartNumber: 2
    }).promise();
    assert(upload_part1.ETag);
    console.log('uploaded part 2', upload_part2);

    const complete = await s3.completeMultipartUpload({
        Bucket,
        Key,
        UploadId,
        MultipartUpload: {
            Parts: [{
                ETag: upload_part1.ETag,
                PartNumber: 1
            }, {
                ETag: upload_part2.ETag,
                PartNumber: 2
            }]
        }
    }).promise();
    assert(complete.ETag);
    console.log('completed multipart upload', complete);

    const part1_req = {
        Bucket,
        Key,
        PartNumber: 1
    };
    const head_part1 = await s3.headObject(part1_req).promise();
    console.log('head part 1', head_part1);
    assert(head_part1.ContentLength === part_size);
    assert(head_part1.PartsCount === 2);

    const get_part1 = await s3.getObject(part1_req).promise();
    console.log('get part 1', get_part1);
    assert(get_part1.ContentLength === part_size);
    assert(get_part1.ContentRange === part1_range_expected);
    // @ts-ignore
    assert(body1.equals(get_part1.Body));

    const part2_req = {
        Bucket,
        Key,
        PartNumber: 2
    };
    const head_part2 = await s3.headObject(part2_req).promise();
    console.log('head part 2', head_part2);
    assert(head_part2.ContentLength === part_size);
    assert(head_part2.PartsCount === 2);

    const get_part2 = await s3.getObject(part2_req).promise();
    console.log('get part 2', get_part2);
    assert(get_part2.ContentLength === part_size);
    assert(get_part2.ContentRange === part2_range_expected);
    // @ts-ignore
    assert(body2.equals(get_part2.Body));


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
