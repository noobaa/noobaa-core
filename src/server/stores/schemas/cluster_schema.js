'use strict';

module.exports = {
    id: 'cluster_schema',
    type: 'object',
    required: [
        '_id',
        'cluster_id',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        cluster_id: {
            type: 'string'
        },
        members: {
            type: 'array',
            items: {
                type: 'object',
                required: ['name', 'address'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    address: {
                        type: 'string',
                    },
                    adminable_state: {
                        type: 'string',
                        enum: ['member', 'detaching', 'attaching'],
                    }
                }
            }

        }
    }
};
