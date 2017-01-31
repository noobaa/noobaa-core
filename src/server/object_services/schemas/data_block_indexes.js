/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
        // update_blocks_of_chunks
        // find_blocks_of_chunks
        // load_blocks_for_chunks()
        fields: {
            chunk: 1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    },
    {
        // iterate_node_chunks()
        // count_blocks_of_node()
        fields: {
            node: 1,
            _id: -1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    }
];
