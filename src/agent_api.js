// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('./restful_api');


module.exports = restful_api.define_api({

    name: 'Account',

    methods: {

        read_block: {
            method: 'GET',
            path: '/block',
            params: {
                type: 'object',
                required: ['block_id'],
                additionalProperties: false,
                properties: {
                    block_id: {
                        type: 'string',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['data'],
                additionalProperties: false,
                properties: {
                    data: {
                        type: 'string',
                    },
                },
            },
        },

        write_block: {
            method: 'POST',
            path: '/block',
            params: {
                type: 'object',
                required: ['block_id', 'data'],
                additionalProperties: false,
                properties: {
                    block_id: {
                        type: 'string',
                    },
                    data: {
                        type: 'string',
                    }
                },
            },
            doc: 'create a new account',
        },

    }

});
