'use strict';

module.exports = {
    id: 'bucket_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'tiering',
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
        tiering: {
            format: 'objectid' // tiering policy id
        },
        // cloud sync target, if exists
        cloud_sync: {
            type: 'object',
            required: ['endpoint'],
            properties: {
                // Target endpoint, location + bucket
                endpoint: {
                    type: 'string'
                },
                target_ip: {
                    type: 'string'
                },
                access_keys: {
                    type: 'object',
                    required: ['access_key', 'secret_key'],
                    properties: {
                        access_key: {
                            type: 'string'
                        },
                        secret_key: {
                            type: 'string'
                        }
                    }
                },
                // Changed Objects query interval (in minutes)
                schedule_min: {
                    type: 'integer'
                },
                // Paused cloud sync
                paused: {
                    type: 'boolean',
                },
                // Last finished sync
                last_sync: {
                    format: 'idate'
                },
                // Enable cloud to NooBaa bucket sync
                c2n_enabled: {
                    type: 'boolean',
                },
                // Enable NooBaa to cloud bucket sync
                n2c_enabled: {
                    type: 'boolean',
                },
                // If true, only additions will be synced, and not deletions
                additions_only: {
                    type: 'boolean',
                }
            }
        },
        stats: {
            type: 'object',
            // required: [],
            properties: {
                reads: {
                    type: 'integer',
                },
                writes: {
                    type: 'integer',
                }
            }
        },
    }
};