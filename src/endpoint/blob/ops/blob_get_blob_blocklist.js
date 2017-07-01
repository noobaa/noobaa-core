/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

// const BlobError = require('../blob_errors').BlobError;

function get_blob_blocklist(req, res) {
    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
        })
        .then(object_md => {
            const block_size = 32 * 1024 * 1024;
            let num_blocks = Math.floor(object_md.size / block_size);
            let last_block_size = object_md.size % block_size;
            if (last_block_size) num_blocks += 1;
            return {
                BlockList: {
                    CommittedBlocks: _.times(num_blocks, i => ({
                        Block: {
                            Name: 'BlockId' + i,
                            Size: i < num_blocks - 1 ? block_size : last_block_size,
                        }
                    }))
                }
            };
        });
}

module.exports = {
    handler: get_blob_blocklist,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
