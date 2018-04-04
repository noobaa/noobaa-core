/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
{
    "s3": {
        "bucket": "images"
    },
    "azure": {
        "container": "plain-blob-storage",
        "account_name": "youraccountname",
        "account_key": "key"
    }
}
*/

var AWS = require('aws-sdk');
var azure_storage = require('azure-storage');

module.exports.handler = (event, context, callback) => {
    var s3_bucket = event.s3.bucket;
    var azure_container = event.azure.container;
    var azure_account_name = event.azure.account_name;
    var azure_account_key = event.azure.account_key;
    var max_keys = event.max_keys || 10;

    var s3 = new AWS.S3();
    var blob = azure_storage.createBlobService(
        `DefaultEndpointsProtocol=https;` +
        `AccountName=${azure_account_name};` +
        `AccountKey=${azure_account_key}`);

    var marker;
    var truncated = true;
    var count = 0;

    loop().then(
        res => callback(null, `${count} Objects Copied`),
        err => callback(err)
    );

    function loop() {
        if (!truncated) return Promise.resolve();
        return make_promise(
                cb => s3.listObjects({
                    Bucket: s3_bucket,
                    Marker: marker,
                    MaxKeys: max_keys,
                }, cb)
            )
            .then(res => {
                marker = res.NextMarker;
                truncated = res.IsTruncated;
                count += res.Contents.length;
                return Promise.all(res.Contents.map(sync_object));
            })
            .then(loop);
    }

    function sync_object(item) {
        return make_promise(
            cb => blob.createBlockBlobFromStream(
                azure_container,
                item.Key,
                s3.getObject({
                    Bucket: s3_bucket,
                    Key: item.Key,
                }).createReadStream(),
                item.Size,
                cb)
        );
    }

    function make_promise(func) {
        return new Promise((resolve, reject) => func((err, res) => (err ? reject(err) : resolve(res))));
    }
};
