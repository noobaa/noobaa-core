'use strict';

module.exports = {
    id: 'pool_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name'
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'idate'
        },
        system: {
            format: 'objectid'
        },
        name: {
            type: 'string'
        },
    }
};
