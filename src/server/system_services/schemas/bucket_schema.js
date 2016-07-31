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
                target_bucket: {
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
        storage_stats: {
            type: 'object',
            required: ['chunks_capacity', 'objects_size', 'objects_count', 'last_update'],
            properties: {
                chunks_capacity: {
                    oneOf: [{
                            type: 'integer'
                        }, {
                            type: 'object',
                            properties: {
                                n: {
                                    type: 'integer',
                                },
                                // to support bigger integers we can specify a peta field
                                // which is considered to be based from 2^50
                                peta: {
                                    type: 'integer',
                                }
                            }
                        }]
                        // $ref: 'common_api#/definitions/bigint'
                },
                objects_size: {
                    oneOf: [{
                            type: 'integer'
                        }, {
                            type: 'object',
                            properties: {
                                n: {
                                    type: 'integer',
                                },
                                // to support bigger integers we can specify a peta field
                                // which is considered to be based from 2^50
                                peta: {
                                    type: 'integer',
                                }
                            }
                        }]
                        // $ref: 'common_api#/definitions/bigint'
                },
                objects_count: {
                    type: 'integer'
                },
                last_update: {
                    format: 'idate'
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
                },
                last_read: {
                    format: 'idate'
                },
                last_write: {
                    format: 'idate'
                }
            }
        },
        demo_bucket: {
            type: 'boolean'
        }

    }
};
