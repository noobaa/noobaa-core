/* Copyright (C) 2016 NooBaa */
'use strict';

const s3ops = require('../utils/s3ops');
const P = require('../../util/promise');
const argv = require('minimist')(process.argv);

const {
    server = '127.0.0.1', // local run on noobaa server
    bucket = 'first.bucket', // default bucket
} = argv;

function clean_up_dataset(server_ip, bucket_name, dataset) {
    console.log('runing clean up dataset ' + dataset + ' from bucket ' + bucket_name);
    return s3ops.get_list_files(server_ip, bucket_name, dataset)
        .then(res => s3ops.delete_folder(server_ip, bucket_name, ...res))
        .catch(err => console.error(`Errors during deleting `, err));
}

P.fcall(function() {
    return s3ops.get_list_prefixes(server, bucket);
})
    .then(res => {
        console.log('list of prefixes ' + res);
        if (res.length > 1) {
            let prefix = res[1];
            console.log("deleting dataset : " + prefix);
            return clean_up_dataset(server, bucket, prefix);
        } else {
            console.log("bucket has only one dataset : " + res + "deleting rejected");
        }
    })
    .then(() => {
        console.log(`Everything finished with success!`);
        process.exit(0);
    })
    .catch(err => {
        console.error(`Errors during test`, err);
        process.exit(1);
    });