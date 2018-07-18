/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
{
    "source_bucket": "first.bucket",
    "target_bucket": "second.bucket",
    "concur": 10,
    "move_objects_older_than_seconds": 3600
}
*/

const AWS = require('aws-sdk');

module.exports.handler = async function(event, context, callback) {
    try {
        const {
            source_bucket,
            target_bucket,
            concur = 10,
            move_objects_older_than_seconds = 3600,
        } = event;

        const s3 = new AWS.S3();
        const move_list = await find_objects_to_move(s3, source_bucket, move_objects_older_than_seconds);
        const move_done_list = [];
        const move_fail_list = [];

        if (move_list.length) {
            await Promise.all(new Array(concur).fill(0).map(() =>
                move_worker(s3, source_bucket, target_bucket, move_list, move_done_list, move_fail_list)
            ));
        }

        return callback(null, `
            ${move_done_list.length} Objects moved successfuly.
            ${move_fail_list.length} Objects failed to move.
        `);

    } catch (err) {
        return callback(err);
    }
};

async function find_objects_to_move(s3, source_bucket, move_objects_older_than_seconds) {
    const all_objects = await list_all(s3, source_bucket);
    const sorted_objects = all_objects.sort((a, b) => a.LastModified.getTime() - b.LastModified.getTime());
    const now = Date.now();
    const move_list = [];
    for (const obj of sorted_objects) {
        if (now - obj.LastModified.getTime() < move_objects_older_than_seconds * 1000) break;
        move_list.push(obj);
    }
    return move_list;
}

/**
 * @param {AWS.S3} s3 
 * @param {String} bucket 
 * @returns {AWS.S3.Object[]}
 */
async function list_all(s3, bucket) {
    const objects = [];
    let truncated = true;
    let marker;
    while (truncated) {
        const list = await s3.listObjects({ Bucket: bucket, Marker: marker }).promise();
        if (list.Contents && list.Contents.length) {
            for (const obj of list.Contents) {
                objects.push(obj);
            }
        }
        truncated = list.IsTruncated;
        marker = list.NextMarker;
    }
    return objects;
}

/**
 * @param {AWS.S3} s3 
 * @param {String} source_bucket 
 * @param {String} target_bucket 
 * @param {AWS.S3.Object[]} move_list 
 * @param {AWS.S3.Object[]} move_done_list 
 * @param {AWS.S3.Object[]} move_fail_list 
 */
async function move_worker(s3, source_bucket, target_bucket, move_list, move_done_list, move_fail_list) {
    while (move_list.length) {
        let obj;
        try {
            obj = move_list.shift();
            await s3.upload({
                Bucket: target_bucket,
                Key: obj.Key,
                Body: s3.getObject({
                    Bucket: source_bucket,
                    Key: obj.Key,
                }).createReadStream(),
            }).promise();
            await s3.deleteObject({ Bucket: source_bucket, Key: obj.Key }).promise();
            move_done_list.push(obj);
        } catch (err) {
            if (obj) move_fail_list.push(obj);
        }
    }
}
