/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
{
    "bucket": "images",
    "are_you_sure": true
}
*/

const AWS = require('aws-sdk');

module.exports.handler = async function(event, context, callback) {
    try {
        const s3 = new AWS.S3();
        const sure = event.are_you_sure === true;

        let truncated = true;
        let key_marker;
        let version_id_marker;
        let count = 0;

        while (truncated) {

            const res = await s3.listObjectVersions({
                Bucket: event.bucket,
                KeyMarker: key_marker,
                VersionIdMarker: version_id_marker
            }).promise();

            const list = [];
            if (res.Versions) {
                for (const it of res.Versions) {
                    list.push({ Key: it.Key, VersionId: it.VersionId });
                }
            }
            if (res.DeleteMarkers) {
                for (const it of res.DeleteMarkers) {
                    list.push({ Key: it.Key, VersionId: it.VersionId });
                }
            }
            truncated = res.IsTruncated;
            key_marker = res.NextKeyMarker;
            version_id_marker = res.NextVersionIdMarker;
            count += list.length;

            if (sure && list.length) {
                await s3.deleteObjects({
                    Bucket: event.bucket,
                    Delete: { Objects: list }
                }).promise();
            }
        }

        const text = sure ? 'Deleted' : 'NOT Deleted (use "are_you_sure": true)';
        return callback(null, `${count} Objects ${text}`);

    } catch (err) {
        return callback(err);
    }
};
