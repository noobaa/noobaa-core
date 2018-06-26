/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
{
    "bucket": "images",
    "are_you_sure": true,
}
*/

const AWS = require('aws-sdk');

module.exports.handler = async function(event, context, callback) {
    try {
        const s3 = new AWS.S3();
        const sure = event.are_you_sure === true;

        let truncated = true;
        let marker;
        let version_id_marker;
        let count = 0;

        while (truncated) {

            const res = await s3.listObjectVersions({
                Bucket: event.bucket,
                Marker: marker,
                VersionIdMarker: version_id_marker
            }).promise();

            const objs = res.Contents;
            truncated = res.IsTruncated;
            marker = res.NextMarker;
            version_id_marker = res.NextVersionIdMarker;
            count += objs.length;

            if (sure && objs.length) {
                await s3.deleteObjects({
                    Bucket: event.bucket,
                    Delete: { Objects: objs.map(o => ({ Key: o.Key, VersionId: o.VersionId })) }
                }).promise();
            }
        }

        const text = sure ? 'Deleted' : 'NOT Deleted (use "are_you_sure": true)';
        return callback(null, `${count} Objects ${text}`);

    } catch (err) {
        return callback(err);
    }
};
