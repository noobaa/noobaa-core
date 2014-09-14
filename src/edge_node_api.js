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
                name: {
                    type: String,
                    required: true,
                },
                ip: {
                    type: String,
                    required: true,
                },
                port: {
                    type: Number,
                    required: true,
                },
            },
        },

        delete_edge_node: {
            method: 'DELETE',
            path: '/',
            params: {
                name: {
                    type: String,
                    required: true,
                },
            },
        },
    }

});
