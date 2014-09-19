// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('./restful_api');


module.exports = restful_api.define_api({

    name: 'EdgeNode',

    methods: {

        connect_edge_node: {
            method: 'POST',
            path: '/',
            params: {
                type: 'object',
                required: ['name', 'ip', 'port'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    ip: {
                        type: 'string',
                    },
                    port: {
                        type: 'number',
                    },
                }
            },
        },

        delete_edge_node: {
            method: 'DELETE',
            path: '/',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
        },

        /*
        add_block: {
            method: 'POST',
            path: '/block',
            reply: {},
        }
        */
    }

});
