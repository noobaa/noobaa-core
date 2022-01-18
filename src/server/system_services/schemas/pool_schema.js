/* Copyright (C) 2016 NooBaa */
'use strict';

const node_schema = require('../../node_services/node_schema');
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
    $id: 'pool_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'resource_type'
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
        resource_type: {
            type: 'string',
            enum: ['HOSTS', 'CLOUD', 'INTERNAL']
        },
        region: {
            type: 'string'
        },
        pool_node_type: node_schema.properties.node_type,
        mongo_pool_info: {
            type: 'object',
            properties: {
                agent_info: {
                    type: 'object',
                    properties: {
                        create_node_token: {
                            type: 'string'
                        },
                        node_token: {
                            type: 'string'
                        },
                        mongo_path: {
                            type: 'string'
                        }
                    }
                },
                pending_delete: {
                    type: 'boolean'
                },
            }
        },
        storage_stats: {
            type: 'object',
            required: ['blocks_size', 'last_update'],
            properties: {
                blocks_size: bigint,
                last_update: {
                    idate: true
                }
            }
        },
        // cloud pool information - exist only for cloud pools
        cloud_pool_info: {
            type: 'object',
            required: ['endpoint', 'target_bucket'],
            properties: {
                // Target endpoint, location + bucket
                endpoint: {
                    type: 'string'
                },
                target_bucket: {
                    type: 'string'
                },
                auth_method: {
                    type: 'string',
                    enum: ['AWS_V2', 'AWS_V4']
                },
                aws_sts_arn: {
                    type: 'string'
                },
                backingstore: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string'
                        },
                        namespace: {
                            type: 'string'
                        }
                    }
                },
                available_capacity: {
                    $ref: 'common_api#/definitions/bigint'
                },
                storage_limit: {
                    $ref: 'common_api#/definitions/bigint'
                },
                access_keys: {
                    type: 'object',
                    required: ['access_key', 'secret_key', 'account_id'],
                    properties: {
                        access_key: { $ref: 'common_api#/definitions/access_key' },
                        secret_key: { $ref: 'common_api#/definitions/secret_key' },
                        account_id: {
                            objectid: true
                        }
                    }
                },
                endpoint_type: {
                    type: 'string',
                    enum: ['AWSSTS', 'AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
                },
                agent_info: {
                    type: 'object',
                    properties: {
                        create_node_token: {
                            type: 'string'
                        },
                        node_token: {
                            type: 'string'
                        },
                        cloud_path: {
                            type: 'string'
                        }
                    }
                },

                pending_delete: {
                    type: 'boolean'
                },
            }
        },
        hosts_pool_info: {
            type: 'object',
            required: [
                'is_managed',
                'host_count'
            ],
            properties: {
                is_managed: {
                    type: 'boolean'
                },
                initialized: {
                    type: 'boolean'
                },
                init_timeout: {
                    idate: true,
                },
                host_count: {
                    type: 'integer',
                    minimum: 0
                },
                host_config: {
                    type: 'object',
                    properties: {
                        volume_size: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                    }
                },
                backingstore: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string'
                        },
                        namespace: {
                            type: 'string'
                        }
                    }
                },
            }
        }
    }
};
