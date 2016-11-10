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
            format: 'date'
        },
        system: {
            format: 'objectid'
        },
        name: {
            type: 'string'
        },

        demo_pool: {
            type: 'boolean'
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
                        }
                    }
                }

            }
        }

    }
};
