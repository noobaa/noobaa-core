'use strict';

module.exports = {
    id: 'system_history_schema',
    type: 'object',
    required: ['_id', 'time_stamp', 'system_snapshot'],
    properties: {
        _id: {
            format: 'objectid'
        },
        time_stamp: {
            format: 'date'
        },
        system_snapshot: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        }
    }
};
