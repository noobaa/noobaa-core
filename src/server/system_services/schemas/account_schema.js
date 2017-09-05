/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'account_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'email',
        'has_login'
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date'
        },
        name: {
            type: 'string'
        },
        email: {
            type: 'string'
        },
        password: {
            type: 'string' // bcrypted password
        },
        next_password_change: {
            format: 'date'
        },
        is_support: {
            type: 'boolean'
        },
        has_login: {
            type: 'boolean'
        },
        access_keys: {
            type: 'array',
            items: {
                type: 'object',
                required: ['access_key', 'secret_key'],
                properties: {
                    access_key: {
                        type: 'string'
                    },
                    secret_key: {
                        type: 'string'
                    }
                }
            }
        },
        allowed_buckets: {
            type: 'object',
            required: ['full_permission'],
            properties: {
                full_permission: {
                    type: 'boolean'
                },
                permission_list: {
                    type: 'array',
                    items: {
                        format: 'objectid'
                    }
                }
            }
        },
        allowed_ips: {
            type: 'array',
            items: {
                type: 'object',
                required: ['start', 'end'],
                properties: {
                    start: {
                        type: 'string'
                    },
                    end: {
                        type: 'string'
                    }
                }
            }
        },
        default_pool: {
            format: 'objectid'
        },
        sync_credentials_cache: {
            type: 'array',
            items: {
                type: 'object',
                required: ['name', 'endpoint', 'access_key', 'secret_key'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    access_key: {
                        type: 'string'
                    },
                    secret_key: {
                        type: 'string'
                    },
                    endpoint: {
                        type: 'string'
                    },
                    endpoint_type: {
                        type: 'string',
                        enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'NOOBAA']
                    }
                }
            }
        }
    }
};
