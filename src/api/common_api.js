'use strict';

/**
 *
 * COMMON API
 *
 * general defenitions used by other api's
 *
 */
module.exports = {

    name: 'common_api',

    methods: {},

    definitions: {


        block_address: {
            type: 'object',
            required: ['id', 'addr'],
            properties: {
                id: {
                    type: 'string'
                },
                addr: {
                    type: 'string'
                },
            }
        },


        storage_info: {
            type: 'object',
            required: [],
            properties: {
                total: {
                    $ref: '/common_api/definitions/bigint'
                },
                free: {
                    $ref: '/common_api/definitions/bigint'
                },
                used: {
                    $ref: '/common_api/definitions/bigint'
                },
                alloc: {
                    $ref: '/common_api/definitions/bigint'
                },
                limit: {
                    $ref: '/common_api/definitions/bigint'
                },
                // real - after calculating dedup reduction or redundancy overheads
                real: {
                    $ref: '/common_api/definitions/bigint'
                },
            }
        },

        drive_info: {
            type: 'object',
            required: [],
            properties: {
                mount: {
                    type: 'string'
                },
                drive_id: {
                    type: 'string'
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
            }
        },

        os_info: {
            type: 'object',
            required: [],
            properties: {
                hostname: {
                    type: 'string'
                },
                ostype: {
                    type: 'string'
                },
                platform: {
                    type: 'string'
                },
                arch: {
                    type: 'string'
                },
                release: {
                    type: 'string'
                },
                uptime: {
                    type: 'integer',
                    format: 'idate',
                },
                loadavg: {
                    type: 'array',
                    items: {
                        type: 'number'
                    }
                },
                totalmem: {
                    type: 'integer'
                },
                freemem: {
                    type: 'integer'
                },
                cpus: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                },
                networkInterfaces: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },


        bigint: {
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
        },

    }
};
