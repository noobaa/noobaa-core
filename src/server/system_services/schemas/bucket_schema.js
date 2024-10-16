/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

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
    $id: 'bucket_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'versioning'
    ],
    properties: {
        _id: {
            objectid: true
        },
        master_key_id: { objectid: true },
        deleted: {
            date: true
        },
        deleting: {
            date: true
        },
        system: {
            objectid: true
        },
        name: {
            wrapper: SensitiveString,
        },
        owner_account: {
            objectid: true
        },
        object_lock_configuration: {
            type: 'object',
            properties: {
                object_lock_enabled: { type: 'string' },
                rule: {
                    type: 'object',
                    properties: {
                        default_retention: {
                            oneOf: [{
                                    type: 'object',
                                    properties: {
                                        years: { type: 'integer' },
                                        mode: {
                                            type: 'string',
                                            enum: ['GOVERNANCE', 'COMPLIANCE']
                                        }
                                    }
                                },
                                {
                                    type: 'object',
                                    properties: {
                                        days: { type: 'integer' },
                                        mode: {
                                            type: 'string',
                                            enum: ['GOVERNANCE', 'COMPLIANCE']
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        },
        namespace: {
            type: 'object',
            required: [
                'read_resources',
            ],
            properties: {
                read_resources: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['resource'],
                        properties: {
                            resource: {
                                objectid: true // namespace resource id
                            },
                            path: { type: 'string' },
                        }
                    }
                },
                write_resource: {
                    type: 'object',
                    required: ['resource'],
                    properties: {
                        resource: {
                            objectid: true // namespace resource id
                        },
                        path: { type: 'string' },
                    }
                },
                should_create_underlying_storage: { type: 'boolean' }, // should create underlying storage
                caching: {
                    $ref: 'common_api#/definitions/bucket_cache_config'
                },
            }
        },

        force_md5_etag: {
            type: 'boolean' // enable md5 calculation per bucket
        },

        tiering: {
            objectid: true // tiering policy id
        },

        replication_policy_id: {
            objectid: true // replication policy id
        },

        quota: {
            $ref: 'common_api#/definitions/quota_config'
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
            $ref: 'common_api#/definitions/bucket_lifecycle_configuration'
        },
        tagging: {
            $ref: 'common_api#/definitions/tagging',
        },
        bucket_claim: {
            type: 'object',
            required: ['bucket_class', 'namespace'],
            properties: {
                // TODO: Fill this with relevant info
                bucket_class: {
                    type: 'string',
                },
                namespace: {
                    type: 'string',
                },
            }
        },
        encryption: {
            $ref: 'common_api#/definitions/bucket_encryption',
        },
        website: {
            $ref: 'common_api#/definitions/bucket_website',
        },
        s3_policy: {
            $ref: 'common_api#/definitions/bucket_policy',
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
                        enum: ['ObjectCreated', 'ObjectRemoved', 'ObjectRead' /* 'ObjectCreated:Put', 'ObjectCreated:CompleteMultipartUpload', ... */ ],
                        type: 'string'
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
                    attempts: {
                        type: 'integer'
                    },
                }
            }
        },
        stats: {
            type: 'object',
            properties: {
                reads: { type: 'integer' },
                writes: { type: 'integer' },
            }
        },
        logging: {
            $ref: 'common_api#/definitions/bucket_logging',
        },
        notifications: {
            type: 'array',
            items: {
                 $ref: 'common_api#/definitions/bucket_notification'
            }
        },
    }
};
