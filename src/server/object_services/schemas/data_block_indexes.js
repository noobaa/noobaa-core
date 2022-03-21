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
            partialFilterExpression: {
                chunk: { $exists: true }
            }
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
            partialFilterExpression: {
                node: { $exists: true }
            }
        }
    },
    {
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            name: "aggregate_by_delete_dates",
            partialFilterExpression: {
                deleted: { $exists: true }
            }
        }
    }
];
