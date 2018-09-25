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
        'versioning'
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
        versioning: {
            type: 'string',
            enum: ['DISABLED', 'SUSPENDED', 'ENABLED']
        },
        tag: {
            type: 'string',
        },
        storage_stats: {
            type: 'object',
            required: ['chunks_capacity', 'pools', 'blocks_size', 'objects_size', 'objects_count', 'last_update'],
            properties: {
                chunks_capacity: bigint,
                blocks_size: bigint,
                objects_size: bigint,
                stats_by_content_type: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['size', 'count'],
                        properties: {
                            content_type: {
                                type: 'string'
                            },
                            size: bigint,
                            count: {
                                type: 'integer'
                            },
                        }
                    }
                },
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
        lambda_triggers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['_id', 'event_name', 'func_name', 'func_version', 'enabled'],
                properties: {
                    _id: {
                        objectid: true
                    },
                    event_name: {
                        type: 'string',
                        enum: ['ObjectCreated', 'ObjectRemoved', /* 'ObjectCreated:Put', 'ObjectCreated:CompleteMultipartUpload', ... */ ]
                    },
                    func_name: {
                        type: 'string'
                    },
                    func_version: {
                        type: 'string'
                    },
                    enabled: {
                        type: 'boolean',
                    },
                    last_run: {
                        idate: true
                    },
                    object_prefix: {
                        type: 'string'
                    },
                    object_suffix: {
                        type: 'string'
                    },
                }
            }
        },
    }
};
