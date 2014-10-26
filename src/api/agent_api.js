// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'agent_api',

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
            reply_raw: true,
        },

        write_block: {
            method: 'POST',
            path: '/block',
            param_raw: 'data',
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
        },

    }

});
