/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const azure_storage = require('../../util/azure_storage_wrap');
const RandStream = require('../../util/rand_stream');

//TODO:: Remove and use cloud_functions::getAzureConnection ??
const {
    AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_ACCOUNT_KEY
} = process.env;

const AzureDefaultConnection = {
    name: 'AZUREConnection',
    endpoint: `https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    endpoint_type: "AZURE",
    identity: AZURE_STORAGE_ACCOUNT_NAME,
    secret: AZURE_STORAGE_ACCOUNT_KEY
};

const blobService = azure_storage.createBlobService(
    AzureDefaultConnection.identity,
    AzureDefaultConnection.secret,
    AzureDefaultConnection.endpoint
);

async function uploadRandomFileDirectlyToAzure(container, file_name, size, err_handler) {
    const message = `Uploading random file ${file_name} to azure container ${container}`;
    console.log(message);
    const streamFile = new RandStream(size, {
        highWaterMark: 1024 * 1024,
    });
    const options = {
        storeBlobContentMD5: true,
        useTransactionalMD5: true,
        transactionalContentMD5: true
    };
    try {
        await P.fromCallback(callback => blobService.createBlockBlobFromStream(container, file_name, streamFile, size, options, callback));
    } catch (err) {
        _handle_error(err, message, err_handler);
    }
}

async function getPropertyBlob(container, file_name, err_handler) {
    const message = `Getting md5 for ${file_name} directly from azure container: ${container}`;
    console.log(message);
    try {
        const blobProperties = await P.fromCallback(callback => blobService.getBlobProperties(container, file_name, callback));
        console.log(JSON.stringify(blobProperties));
        return {
            md5: blobProperties.contentSettings.contentMD5,
            size: blobProperties.contentLength
        };
    } catch (err) {
        _handle_error(err, message, err_handler);
    }
}

async function getListFilesAzure(bucket, err_handler) {
    const message = `Getting list of files from azure container for ${bucket}`;
    console.log(message);
    try {
        const blobs = await P.fromCallback(callback => blobService.listBlobsSegmented(bucket, null, callback));
        return blobs.entries.map(blob => blob.name);
    } catch (err) {
        _handle_error(err, message, err_handler);
    }
}

function _handle_error(err, message, err_handler) {
    console.error(`Failed ${message}`);
    if (err_handler) {
        err_handler(message, err);
    } else {
        throw err;
    }
}

exports.AzureDefaultConnection = AzureDefaultConnection;
exports.uploadRandomFileDirectlyToAzure = uploadRandomFileDirectlyToAzure;
exports.getPropertyBlob = getPropertyBlob;
exports.getListFilesAzure = getListFilesAzure;
