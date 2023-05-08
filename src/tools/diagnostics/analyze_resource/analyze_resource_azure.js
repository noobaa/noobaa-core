/* Copyright (C) 2023 NooBaa */
'use strict';

const { inspect } = require('util');
const AZURE = require('@azure/storage-blob');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('analyze_resource');
const cloud_utils = require('../../../util/cloud_utils');
const SensitiveString = require('../../../util/sensitive_string');
const CloudVendor = require('./analyze_resource_cloud_vendor_abstract');

/**
 * @typedef {{
 *      account_name:  SensitiveString | string, 
 *      account_key:  SensitiveString | string,
 *      endpoint: string,
 * }} AnalyzeAzureSpec
 */

class AnalyzeAzure extends CloudVendor {

    constructor(account_name, account_key, endpoint) {
        super(); // Constructors for derived classes must contain a 'super' call.

        // in case account_name or account_key are from type strings
        const account_name_sensitive = account_name instanceof SensitiveString ? account_name : new SensitiveString(account_name);
        const account_key_sensitive = account_key instanceof SensitiveString ? account_key : new SensitiveString(account_key);

        // get_azure_new_connection_string assumes account_name and account_key are from type SensitiveString
        const connectionString = cloud_utils.get_azure_new_connection_string({
            endpoint: endpoint,
            access_key: account_name_sensitive, // Azure storage account name is stored as access key
            secret_key: account_key_sensitive,
        });
        this.azure_blob = AZURE.BlobServiceClient.fromConnectionString(connectionString);
    }

    async list_objects(container) {
        const container_client = this.azure_blob.getContainerClient(container);
        dbg.log0('Calling Azure container_client.listBlobsFlat');
        const blobs = container_client.listBlobsFlat();
        const blob_names = [];

        // this part was partially taken from Azure documentation (List the blobs in a container)
        // https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-nodejs?tabs=managed-identity%2Croles-azure-portal%2Csign-in-azure-cli#list-the-blobs-in-a-container

        for await (const blob of blobs) {
            const block_blob_client = container_client.getBlockBlobClient(blob.name);
            dbg.log0(`\tname: ${blob.name}\tURL: ${block_blob_client.url}\n`);
            blob_names.push(blob.name);
            if (blob_names.length === CloudVendor.MAX_KEYS) break;
        }
        console.info(`List objects: ${blob_names}`);

        this.blob = '';
        if (blob_names.length > 0) {
            this.blob = blob_names[0];
        }
    }

    async get_key() {
        return this.blob;
    }

    async head_object(container, blob) {
        const container_client = this.azure_blob.getContainerClient(container);
        const blob_client = container_client.getBlobClient(blob).getBlockBlobClient();
        dbg.log0('Calling Azure blob_client.getProperties');
        const meta_data = await blob_client.getProperties();
        dbg.log0(`Head of ${blob} response: ${inspect(meta_data)}`);
    }

    async write_object(container, blob) {
        const container_client = this.azure_blob.getContainerClient(container);
        const block_blob_client = container_client.getBlockBlobClient(blob);

        // this part was partially taken from Azure documentation (Upload blobs to a container)
        // https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-nodejs?tabs=managed-identity%2Croles-azure-portal%2Csign-in-azure-cli#upload-blobs-to-a-container

        const data = ''; // Upload data to the blob
        dbg.log0('Calling Azure blockBlobClient.upload');
        const upload_Blob_response = await block_blob_client.upload(data, data.length);
        dbg.log0(`Write of ${blob} to URL: ${block_blob_client.url} requestId: ${upload_Blob_response.requestId}`);
    }

    async delete_object(container, blob) {
        const container_client = this.azure_blob.getContainerClient(container);
        dbg.log0('Calling Azure container_client.deleteBlob');
        await container_client.deleteBlob(blob);
        dbg.log0(`Delete of ${blob} done`);
    }
}

// EXPORTS
module.exports = AnalyzeAzure;
