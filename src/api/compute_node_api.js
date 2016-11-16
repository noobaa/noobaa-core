/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * LAMBDA API
 *
 */
module.exports = {

    id: 'compute_node_api',

    methods: {

        invoke_func: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'name',
                    'version',
                    'code_size',
                    'code_sha256'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    code_size: {
                        type: 'integer'
                    },
                    code_sha256: {
                        type: 'string'
                    },
                    event: {
                        $ref: 'lambda_api#/definitions/event_type'
                    }
                },
            },
            reply: {
                type: 'object',
                properties: {
                    result: {
                        $ref: 'lambda_api#/definitions/event_type'
                    },
                    error: {
                        $ref: 'lambda_api#/definitions/error_type'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

    },

    definitions: {

    }

};
