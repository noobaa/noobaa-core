// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'agent_host_api',

    methods: {

        get_agent_status: {
            method: 'GET',
            path: '/status/:name',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['status'],
                properties: {
                    status: {
                        type: 'boolean',
                    },
                },
            }
        },

        start_agent: {
            method: 'POST',
            path: '/start/:name',
            params: {
                type: 'object',
                required: ['name', 'geolocation', 'account_credentials'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    geolocation: {
                        type: 'string',
                    },
                    account_credentials: {
                        type: 'object',
                        required: ['email', 'password'],
                        properties: {
                            email: {
                                type: 'string',
                            },
                            password: {
                                type: 'string',
                            },
                        }
                    }
                },
            },
        },

        stop_agent: {
            method: 'POST',
            path: '/stop/:name',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
        },

    }

});
