'use strict';
var azure = require('azure-storage');
var AWS = require('aws-sdk');

module.exports.handler = (event, context, callback) => {
    var s3_bucket = event.s3.bucket;
    var azure_container = event.azure.container;
    var azure_account_name = event.azure.account_name;
    var azure_account_key = event.azure.account_key;

    var s3 = new AWS.S3();
    var blob = azure.createBlobService(
        `DefaultEndpointsProtocol=https;` +
        `AccountName=${azure_account_name};` +
        `AccountKey=${azure_account_key}`);

    for_every_s3_object(sync_to_azure_blob)
        .then(
            res => callback(null, res),
            err => callback(err)
        );

    function for_every_s3_object(on_each_item) {
        return make_promise(
                cb => s3.listObjects({
                    Bucket: s3_bucket
                }, cb)
            )
            .then(res => Promise.all(
                    res.Contents.map(on_each_item)
                )
                .then(() => ({
                    count: res.Contents.length
                }))
            );
    }

    function sync_to_azure_blob(item) {
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
