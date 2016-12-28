'use strict';

/**
 *
 * CLOUD_SYNC API
 *
 *
 */
module.exports = {

    id: 'cloud_sync_api',

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
                        $ref: 'bucket_api#/definitions/api_cloud_sync_status'
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
                required: ['bucket_id'],
                properties: {
                    bucket_id: {
                        type: 'string',
                    },
                    system_id: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },

};
