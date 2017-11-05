/* Copyright (C) 2016 NooBaa */
'use strict';


const bigint = {
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
};

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
            objectid: true
        },
        deleted: {
            date: true
        },
        system: {
            objectid: true
        },
        name: {
            type: 'string'
        },
        namespace: {
            type: 'object',
            required: [
                'read_resources',
                'write_resource',
            ],
            properties: {
                read_resources: {
                    type: 'array',
                    items: {
                        objectid: true // namespace resource id
                    }
                },
                write_resource: {
                    objectid: true // namespace resource id
                }
            }
        },
        tiering: {
            objectid: true // tiering policy id
        },
        quota: {
            type: 'object',
            required: ['size', 'unit', 'value'],
            properties: {
                size: {
                    type: 'integer'
                },
                unit: {
                    type: 'string',
                    enum: ['GIGABYTE', 'TERABYTE', 'PETABYTE']
                },
                value: bigint
            }
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
                endpoint_type: {
                    type: 'string',
                    enum: ['AWS', 'AZURE', 'S3_COMPATIBLE']
                },
                target_bucket: {
                    type: 'string'
                },
                access_keys: {
                    type: 'object',
                    required: ['access_key', 'secret_key', 'account_id'],
                    properties: {
                        access_key: {
                            type: 'string'
                        },
                        secret_key: {
                            type: 'string'
                        },
                        account_id: {
                            objectid: true
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
                    idate: true
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
            required: ['chunks_capacity', 'pools', 'blocks_size', 'objects_size', 'objects_count', 'last_update'],
            properties: {
                chunks_capacity: bigint,
                blocks_size: bigint,
                objects_size: bigint,
                objects_count: {
                    type: 'integer'
                },
                pools: {
                    type: 'object',
                    patternProperties: {
                        '^[a-z0-9]+$': {
                            type: 'object',
                            required: ['blocks_size'],
                            properties: {
                                blocks_size: bigint,
                            },
                        }
                    },
                },
                objects_hist: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            aggregated_sum: bigint,
                            count: bigint,
                            label: {
                                type: 'string'
                            }
                        }
                    }
                },
                last_update: {
                    idate: true
                }
            }
        },
        //lifecycle rules if exist
        lifecycle_configuration_rules: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'prefix', 'status', 'expiration'],
                properties: {
                    id: {
                        type: 'string'
                    },
                    prefix: {
                        type: 'string'
                    },
                    status: {
                        type: 'string'
                    },
                    expiration: {
                        type: 'object',
                        properties: {
                            days: {
                                type: 'integer'
                            },
                            date: {
                                idate: true
                            },
                            expired_object_delete_marker: {
                                type: 'boolean'
                            }

                        }
                    },
                    abort_incomplete_multipart_upload: {
                        type: 'object',
                        properties: {
                            days_after_initiation: {
                                type: 'integer'
                            },
                        }
                    },
                    transition: {
                        type: 'object',
                        properties: {
                            date: {
                                idate: true
                            },
                            storage_class: {
                                type: 'string',
                                enum: ['STANDARD_IA', 'GLACIER'],
                            }
                        }
                    },
                    noncurrent_version_expiration: {
                        type: 'object',
                        properties: {
                            noncurrent_days: {
                                type: 'integer'
                            },
                        }
                    },
                    noncurrent_version_transition: {
                        type: 'object',
                        properties: {
                            noncurrent_days: {
                                type: 'integer'
                            },
                            storage_class: {
                                type: 'string',
                                enum: ['STANDARD_IA', 'GLACIER'],
                            }
                        }
                    },
                    last_sync: {
                        idate: true
                    }
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
                    idate: true
                },
                last_write: {
                    idate: true
                }
            }
        },

    }
};
