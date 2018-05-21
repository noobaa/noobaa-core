/* Copyright (C) 2016 NooBaa */
'use strict';


function format_block_list(block_list) {
    return block_list.map(block => ({
        Block: {
            Name: block.block_id,
            Size: block.size
        }
    }));
}


async function get_blob_blocklist(req, res) {
    const list_type = req.query.blocklisttype.toLowerCase();
    const requested_lists = {
        committed: !req.query.blocklisttype ||
            list_type === 'all' || list_type === 'committed',
        uncommitted: req.query.blocklisttype &&
            (list_type === 'all' || list_type === 'uncommitted')
    };

    const block_lists = await req.object_sdk.get_blob_block_lists({
        bucket: req.params.bucket,
        key: req.params.key,
        requested_lists
    });

    const response = {
        BlockList: {}
    };
    if (block_lists.committed) {
        response.BlockList.CommittedBlocks = format_block_list(block_lists.committed);
    }
    if (block_lists.uncommitted) {
        response.BlockList.UncommittedBlocks = format_block_list(block_lists.uncommitted);
    }

    return response;
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
