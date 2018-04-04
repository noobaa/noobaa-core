/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
{
    "source_bucket": "first.bucket",
    "target_bucket": "second.bucket",
    "are_you_sure": true,
    "concur": 10
}
*/

const AWS = require('aws-sdk');

module.exports.handler = async function(event, context, callback) {
    try {
        const {
            source_bucket,
            target_bucket,
            are_you_sure = false,
            concur = 10
        } = event;

        const s3 = new AWS.S3();
        const copy_list = [];
        const copy_done_list = [];
        const copy_fail_list = [];
        const exist_list = [];

        const source_map = await list_all(s3, source_bucket);
        const target_map = await list_all(s3, target_bucket);

        for (const source of source_map.values()) {
            const target = target_map.get(source.Key);
            if (target && target.Etag === source.Etag && target.Size === source.Size) {
                exist_list.push(source);
            } else {
                copy_list.push(source);
            }
        }

        if (!are_you_sure) {
            return callback(null, `
                ${copy_list.length} Objects to copy.
                ${exist_list.length} Objects already exist.
                (use "are_you_sure": true)
            `);
        }

        if (copy_list.length) {
            await Promise.all(new Array(concur).fill(0).map(() =>
                copy_worker(s3, source_bucket, target_bucket, copy_list, copy_done_list, copy_fail_list)
            ));
        }

        return callback(null, `
            ${copy_done_list.length} Objects copied successfuly.
            ${copy_fail_list.length} Objects failed to copy.
            ${exist_list.length} Objects already exist.
        `);

    } catch (err) {
        return callback(err);
    }
};

async function list_all(s3, bucket) {
    const objects_map = new Map();
    let truncated = true;
    let marker;

    while (truncated) {
        const list = await s3.listObjects({ Bucket: bucket, Marker: marker }).promise();
        if (list.Contents && list.Contents.length) {
            for (const obj of list.Contents) {
                objects_map.set(obj.Key, obj);
            }
        }
        truncated = list.IsTruncated;
        marker = list.NextMarker;
    }

    return objects_map;
}

async function copy_worker(s3, source_bucket, target_bucket, copy_list, copy_done_list, copy_fail_list) {
    while (copy_list.length) {
        let obj;
        try {
            obj = copy_list.shift();

            await s3.upload({
                Bucket: target_bucket,
                Key: obj.Key,
                Body: s3.getObject({
                    Bucket: source_bucket,
                    Key: obj.Key,
                }).createReadStream(),
            }).promise();

            copy_done_list.push(obj);

        } catch (err) {
            if (obj) copy_fail_list.push(obj);
        }
    }
}