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
    id: 'pool_schema',
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
                        mongo_pool: {
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
            required: ['endpoint', 'target_bucket', 'access_keys'],
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
                endpoint_type: {
                    type: 'string',
                    enum: ['AWS', 'AZURE', 'S3_COMPATIBLE']
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
                        cloud_pool: {
                            type: 'string'
                        }
                    }
                },

                pending_delete: {
                    type: 'boolean'
                },
            }
        }

    }
};
