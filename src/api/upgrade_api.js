/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * UPGRADE API
 *
 * UPGRADE
 *
 */
module.exports = {

    id: 'upgrade_api',

    methods: {

        upgrade_cluster: {
            method: 'POST',
            auth: {
                system: 'admin',
            }
        },

        member_pre_upgrade: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['filepath', 'mongo_upgrade'],
                properties: {
                    filepath: {
                        type: 'string'
                    },
                    mongo_upgrade: {
                        type: 'boolean'
                    },
                    stage: {
                        type: 'string',
                        enum: [
                            'UPGRADE_STAGE',
                            'UPLOAD_STAGE',
                            'RETEST_STAGE'
                        ]
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        cluster_pre_upgrade: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    filepath: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        do_upgrade: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    filepath: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        get_upgrade_status: {
            doc: 'get the status of cluster upgrade',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['in_process'],
                properties: {
                    in_process: {
                        type: 'boolean'
                    },
                }
            },
            auth: {
                system: false
            }
        },

        reset_upgrade_package_status: {
            doc: 'reset upgrade package status on a new upload',
            method: 'POST',
            auth: {
                system: 'admin',
            }
        },

    },

};
