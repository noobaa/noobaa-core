/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');
const mime = require('mime');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/put-block-list
 */
async function put_blob_blocklist(req, res) {

    const req_list = _.get(req.body, 'BlockList.$$') || [];
    const block_list = req_list.map((block, i) => ({ block_id: block._, type: block['#name'].toLowerCase(), num: i + 1 }));

    // TODO: handle x-ms-blob-content-md5 header
    const reply = await req.object_sdk.commit_blob_block_list({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['x-ms-blob-content-type'] || mime.getType(req.params.key) || 'application/octet-stream',
        md_conditions: http_utils.get_md_conditions(req),
        xattr: blob_utils.get_request_xattr(req),
        block_list
    });

    res.setHeader('ETag', `"${reply.etag}"`);
    res.statusCode = 201;
}

module.exports = {
    handler: put_blob_blocklist,
    body: {
        type: 'xml',
        // The Put Block List operation enforces the order in which blocks are to be combined to create a blob
        // preserv the order when parsing the xml
        xml_options: {
            preserveChildrenOrder: true,
            explicitChildren: true
        }
    },
    reply: {
        type: 'empty',
    },
};
