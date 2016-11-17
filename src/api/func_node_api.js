/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * FUNC NODE API
 *
 */
module.exports = {

    id: 'func_node_api',

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
                        $ref: 'func_api#/definitions/event_type'
                    }
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

    }

};
