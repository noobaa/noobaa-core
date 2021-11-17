/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * FUNC NODE API
 *
 */
module.exports = {

    $id: 'func_node_api',

    methods: {

        invoke_func: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['config'],
                properties: {
                    config: {
                        $ref: 'func_api#/definitions/func_config'
                    },
                    event: {
                        $ref: 'func_api#/definitions/event_type'
                    },
                    aws_config: {
                        $ref: '#/definitions/aws_config'
                    },
                    rpc_options: {
                        $ref: '#/definitions/rpc_options'
                    },
                },
            },
            reply: {
                type: 'object',
                properties: {
                    result: {
                        $ref: 'func_api#/definitions/event_type'
                    },
                    error: {
                        $ref: 'func_api#/definitions/error_type'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

    },

    definitions: {

        aws_config: {
            type: 'object',
            properties: {
                endpoint: {
                    type: 'string'
                },
                region: {
                    type: 'string'
                },
                sslEnabled: {
                    type: 'boolean'
                },
                s3ForcePathStyle: {
                    type: 'boolean'
                },
                accessKeyId: {
                    type: 'string'
                },
                secretAccessKey: {
                    type: 'string'
                },
            }
        },

        rpc_options: {
            type: 'object',
            properties: {
                address: {
                    type: 'string'
                },
                auth_token: {
                    oneOf: [{
                        type: 'string'
                    }, {
                        type: 'object',
                        additionalProperties: true,
                        properties: {},
                    }]
                },
            }
        }

    }

};
