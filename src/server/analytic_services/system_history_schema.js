/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'system_history_schema',
    type: 'object',
    required: ['_id', 'time_stamp', 'system_snapshot'],
    properties: {
        _id: {
            objectid: true
        },
        time_stamp: {
            date: true
        },
        system_snapshot: { // Future proofing system snapshots. Old snapshots not conforming to upgrades is expected and fine so the data here is not validated
            type: 'object',
            additionalProperties: true,
            properties: {}
        }
    }
};
