'use strict';

/**
 *
 * CLOUD_SYNC API
 *
 *
 */
module.exports = {

    name: 'cloud_sync_api',

    methods: {
        get_policy_status: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['sysid', 'bucketid'],
                properties: {
                    sysid: {
                        type: 'string',
                    },
                    bucketid: {
                        type: 'string',
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['status', 'health'],
                properties: {
                    status: {
                        $ref: '/bucket_api/definitions/sync_status_enum'
                    },
                    health: {
                        type: 'boolean'
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        refresh_policy: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['sysid', 'bucketid', 'force_stop'],
                properties: {
                    sysid: {
                        type: 'string',
                    },
                    bucketid: {
                        type: 'string',
                    },
                    force_stop: {
                        type: 'boolean'
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },

};
