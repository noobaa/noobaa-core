/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const azure_storage = require('../../util/azure_storage_wrap');
const RandStream = require('../../util/rand_stream');

const AzureDefaultConnection = {
    name: 'AZUREConnection',
    endpoint: "https://jenkinspipeline7.blob.core.windows.net",
    endpoint_type: "AZURE",
    identity: "jenkinspipeline7",
    secret: "Zva2tNcZzdrzvn4Nhci+g0slAso2mRi3vklPEgvKJ4cWBaNIjnjcLdYLZAzyczKlFmYqZPlzuUq8EN9XDfr+gw=="
};

const blobService = azure_storage.createBlobService(
    AzureDefaultConnection.identity,
    AzureDefaultConnection.secret,
    AzureDefaultConnection.endpoint);

function uploadRandomFileToAzure(container, file_name, size, err_handler) {
    const message = `Uploading random file ${file_name} to azure container ${container}`;
    console.log(message);
    let streamFile = new RandStream(size, {
        highWaterMark: 1024 * 1024,
    });
    let options = {
        storeBlobContentMD5: true,
        useTransactionalMD5: true,
        transactionalContentMD5: true
    };
    return P.fromCallback(callback => blobService.createBlockBlobFromStream(container, file_name, streamFile, size, options, callback))
        .catch(err => _handle_error(err, message, err_handler));
}

function getMD5Blob(container, file_name, err_handler) {
    const message = `Getting md5 for ${file_name} azure container ${container}`;
    console.log(message);
    return P.fromCallback(callback => blobService.getBlobProperties(container, file_name, callback))
        .then(res => {
            console.log(JSON.stringify(res));
            return res.contentSettings.contentMD5;
        })
        .catch(err => _handle_error(err, message, err_handler));
}

function getListFilesAzure(bucket, err_handler) {
    const message = `Getting list of files from azure container for ${bucket}`;
    console.log(message);
    let blobs = [];
    return P.fromCallback(callback => blobService.listBlobsSegmented(bucket, null, callback))
        .then(res => {
            res.entries.forEach(function(blob) {
                blobs.push(blob.name);
            });
        })
        .then(() => blobs)
        .catch(err => _handle_error(err, message, err_handler));
}

function _handle_error(err, mesage, err_handler) {
    console.error(`Failed ${mesage}`);
    if (err_handler) {
        err_handler(mesage, err);
    } else {
        throw err;
    }
}


exports.AzureDefaultConnection = AzureDefaultConnection;
exports.uploadRandomFileToAzure = uploadRandomFileToAzure;
exports.getMD5Blob = getMD5Blob;
exports.getListFilesAzure = getListFilesAzure;
