/* Copyright (C) 2016 NooBaa */
'use strict';
const crypto_utils = require('./crypto_utils');
const azure_storage = require('@azure/storage-blob');
// needed only for enerateBlockIdPrefix() and get_block_id() functions
const old_azure_storage = require('azure-storage');

azure_storage.get_container_client = (blob_service, container) => blob_service.getContainerClient(container);

azure_storage.get_blob_client = (container_client, blob) => container_client.getBlobClient(blob).getBlockBlobClient();

azure_storage.calc_body_md5 = stream_file => crypto_utils.calc_body_md5(stream_file);

// create old lib blob service - needed for functions that do not exist in the new lib
// needed only for generateBlockIdPrefix() and get_block_id() functions
azure_storage.get_old_blob_service_conn_string = conn_string => {
    const sliced_conn_string = conn_string.slice(0, conn_string.indexOf('EndpointSuffix'));
    console.log('get_old_blob_service_conn_string: ', sliced_conn_string);
    return old_azure_storage.createBlobService(sliced_conn_string);
};
azure_storage.get_old_blob_service_creds = (account, pass, endpoint) => {
    console.log('get_old_blob_service_creds: ', account, pass, endpoint);
    return old_azure_storage.createBlobService(account, pass, endpoint);

};
// these 2 functions are using the old blob service since there is no matching functions in the new lib
azure_storage.generate_block_id_prefix = old_blob_service => old_blob_service.generateBlockIdPrefix();
azure_storage.get_block_id = (old_blob_service, block_id_prefix, part_num) => old_blob_service.getBlockId(block_id_prefix, part_num);

azure_storage.CONCURRENCY_NUM = 20;
module.exports = azure_storage;
