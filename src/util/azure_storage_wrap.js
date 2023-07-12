/* Copyright (C) 2016 NooBaa */
'use strict';
const crypto_utils = require('./crypto_utils');
const azure_storage = require('@azure/storage-blob');

azure_storage.get_container_client = (blob_service, container) => blob_service.getContainerClient(container);

azure_storage.get_blob_client = (container_client, blob) => container_client.getBlobClient(blob).getBlockBlobClient();

azure_storage.calc_body_md5 = stream_file => crypto_utils.calc_body_md5(stream_file);

// these 3 functions are taken from azure storage just to keep the 
// existing way we are using and removing the deprecated azure-storage dependency.
// Need to reevaluate the need.
// https://github.com/Azure/azure-storage-node/blob/master/lib/services/blob/blobservice.core.js/#L3663-L3676
azure_storage.generate_block_id_prefix = () => {
    const prefix = Math.floor(Math.random() * 0x100000000).toString(16);
    return _zeroPaddingString(prefix, 8);

};

azure_storage.get_block_id = (block_id_prefix, part_num) => block_id_prefix + '-' + _zeroPaddingString(part_num, 6);

// https://github.com/Azure/azure-storage-node/blob/master/lib/common/util/util.js#L148-L158
function _zeroPaddingString(str, len) {
    const paddingStr = '0000000000' + str;
    if (paddingStr.length < len) {
        return _zeroPaddingString(paddingStr, len);
    } else {
        return paddingStr.substr(-1 * len);
    }
}

module.exports = azure_storage;
