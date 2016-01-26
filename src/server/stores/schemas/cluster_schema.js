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
    }
};
