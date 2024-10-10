/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../util/sensitive_string');

/**
 *
 * ACCOUNT API
 *
 * admin on web client sends commands to web server
 *
 */
module.exports = {

    $id: 'account_api',

    methods: {

        create_account: {
            doc: 'Create a new account',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'email', 'has_login', 's3_access'],
                properties: {
                    name: { $ref: 'common_api#/definitions/account_name' },
                    email: { $ref: 'common_api#/definitions/email' },
                    password: { $ref: 'common_api#/definitions/password' },
                    must_change_password: {
                        type: 'boolean',
                    },
                    has_login: {
                        type: 'boolean'
                    },
                    s3_access: {
                        type: 'boolean'
                    },
                    default_resource: {
                        type: 'string',
                    },
                    allow_bucket_creation: {
                        type: 'boolean'
                    },
                    roles: {
                        type: 'array',
                        items: {
                            type: 'string',
                            enum: ['admin', 'user', 'viewer', 'operator']
                        }
                    },
                    bucket_claim_owner: {
                        $ref: 'common_api#/definitions/bucket_name'
                    },
                    //Special handling for the first account created with create_system
                    new_system_parameters: {
                        type: 'object',
                        properties: {
                            new_system_id: {
                                type: 'string'
                            },
                            account_id: {
                                type: 'string'
                            },
                            default_resource: {
                                type: 'string',
                            },
                        },
                    },
                    force_md5_etag: {
                        type: 'boolean'
                    },
                    nsfs_account_config: {
                        $ref: 'common_api#/definitions/nsfs_account_config'
                    },
                    access_keys: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/access_keys'
                        }
                    },
                    role_config: {
                        $ref: 'common_api#/definitions/role_config'
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string'
                    },
                    access_keys: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/access_keys'
                        }
                    },
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        },

        create_external_user_account: {
            doc: 'Create an account based on an oauth user identity',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                    name: { $ref: 'common_api#/definitions/account_name' },
                    email: { $ref: 'common_api#/definitions/email' }
                }
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string'
                    },
                    access_keys: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/access_keys'
                        }
                    }
                }
            },
            auth: {
                system: 'admin',
                account: true
            }
        },

        read_account: {
            doc: 'Read the info of the authorized account',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                }
            },
            reply: {
                $ref: '#/definitions/account_info'
            },
            auth: {
                system: false
            }
        },

        read_account_by_access_key: {
            doc: 'Read the info of access_key account',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                }
            },
            reply: {
                $ref: '#/definitions/account_info'
            },
            auth: {
                system: 'admin',
            }
        },

        update_account: {
            doc: 'Update the info of the authorized account',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    name: { $ref: 'common_api#/definitions/account_name' },
                    email: { $ref: 'common_api#/definitions/email' },
                    must_change_password: {
                        type: 'boolean',
                    },
                    new_email: { $ref: 'common_api#/definitions/email' },
                    ips: {
                        anyOf: [{
                            type: 'null'
                        }, {
                            type: 'array',
                            items: {
                                $ref: 'common_api#/definitions/ip_range'
                            }
                        }]
                    },
                    preferences: {
                        type: 'object',
                        properties: {
                            ui_theme: {
                                type: 'string',
                                enum: ['DARK', 'LIGHT']
                            }
                        }
                    },
                    role_config: {
                        $ref: 'common_api#/definitions/role_config'
                    },
                    remove_role_config: {
                        type: 'boolean'
                    },
                }
            },
            auth: {
                system: false
            }
        },

        reset_password: {
            doc: 'Reset an account password',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email', 'verification_password', 'password'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                    verification_password: { $ref: 'common_api#/definitions/password' },
                    password: { $ref: 'common_api#/definitions/password' },
                    must_change_password: {
                        type: 'boolean'
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

        generate_account_keys: {
            doc: 'Generate new account keys',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        update_account_keys: {
            doc: 'Update account keys of the authorized account',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email', 'access_keys'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                    access_keys: { $ref: 'common_api#/definitions/access_keys' },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        verify_authorized_account: {
            doc: 'Verify authorized account password',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['verification_password'],
                properties: {
                    verification_password: { $ref: 'common_api#/definitions/password' },
                },
            },
            reply: {
                type: 'boolean'
            },
            auth: {
                system: 'admin'
            }
        },

        update_account_s3_access: {
            doc: 'Update bucket s3 access permissions',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email', 's3_access'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                    s3_access: {
                        type: 'boolean'
                    },
                    default_resource: {
                        type: 'string'
                    },
                    allow_bucket_creation: {
                        type: 'boolean'
                    },
                    force_md5_etag: {
                        type: 'boolean'
                    },
                    nsfs_account_config: {
                        type: 'object',
                        properties: {
                            distinguished_name: { wrapper: SensitiveString },
                            uid: { type: 'number' },
                            gid: { type: 'number' },
                            new_buckets_path: { type: 'string' },
                            nsfs_only: { type: 'boolean' }
                        }
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        delete_account: {
            doc: 'Delete a given account',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_account_by_property: {
            doc: 'Delete a given account by property',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['nsfs_account_config'],
                properties: {
                    nsfs_account_config: {
                        oneOf: [{
                            type: 'object',
                            required: ['uid', 'gid'],
                            properties: {
                                uid: { type: 'number' },
                                gid: { type: 'number' },
                            }
                        }, {
                            type: 'object',
                            required: ['distinguished_name'],
                            properties: {
                                distinguished_name: { wrapper: SensitiveString },
                            }
                        }]
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        list_accounts: {
            doc: 'List accounts',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'object',
                        properties: {
                            fs_identity: {
                                oneOf: [{
                                    type: 'object',
                                    required: ['uid', 'gid'],
                                    properties: {
                                        uid: { type: 'number' },
                                        gid: { type: 'number' },
                                    }
                                }, {
                                    type: 'object',
                                    required: ['distinguished_name'],
                                    properties: {
                                        distinguished_name: { wrapper: SensitiveString },
                                    }
                                }]
                            }
                        }
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['accounts'],
                properties: {
                    accounts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/account_info'
                        }
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        accounts_status: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['has_accounts'],
                properties: {
                    has_accounts: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        },

        add_external_connection: {
            doc: 'Add a connection to authorized account\'s connections cache',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'endpoint', 'endpoint_type'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    endpoint: {
                        type: 'string'
                    },
                    identity: { $ref: 'common_api#/definitions/access_key' },
                    secret: { $ref: 'common_api#/definitions/secret_key' },
                    azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                    aws_sts_arn: {
                        type: 'string'
                    },
                    region: {
                        type: 'string'
                    },
                    auth_method: {
                        $ref: 'common_api#/definitions/cloud_auth_method'
                    },
                    cp_code: {
                        type: 'string'
                    },
                    endpoint_type: {
                        $ref: 'common_api#/definitions/endpoint_type'
                    },
                    gcp_hmac_key: {
                        $ref: 'common_api#/definitions/gcp_hmac_key'
                    }

                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_external_connection: {
            doc: 'Update a connection in authorized account\'s connections cache',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'secret'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    identity: { $ref: 'common_api#/definitions/access_key' },
                    secret: { $ref: 'common_api#/definitions/secret_key' },
                    azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                    region: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        check_external_connection: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['endpoint', 'endpoint_type'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    endpoint: {
                        type: 'string'
                    },
                    identity: { $ref: 'common_api#/definitions/access_key' },
                    secret: { $ref: 'common_api#/definitions/secret_key' },
                    azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                    aws_sts_arn: {
                        type: 'string'
                    },
                    region: {
                        type: 'string'
                    },
                    auth_method: {
                        $ref: 'common_api#/definitions/cloud_auth_method'
                    },
                    cp_code: {
                        type: 'string'
                    },
                    endpoint_type: {
                        $ref: 'common_api#/definitions/endpoint_type'
                    },
                    ignore_name_already_exist: {
                        type: 'boolean'
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['status'],
                properties: {
                    status: {
                        type: 'string',
                        enum: [
                            'SUCCESS',
                            'TIMEOUT',
                            'INVALID_ENDPOINT',
                            'INVALID_CREDENTIALS',
                            'NOT_SUPPORTED',
                            'TIME_SKEW',
                            'UNKNOWN_FAILURE'
                        ]
                    },
                    error: {
                        type: 'object',
                        required: ['code', 'message'],
                        properties: {
                            code: {
                                type: 'string'
                            },
                            message: {
                                type: 'string'
                            },
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_external_connection: {
            doc: 'delete a connection from an account',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['connection_name'],
                properties: {
                    connection_name: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_account_usage: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['since', 'till'],
                properties: {
                    since: { idate: true },
                    till: { idate: true },
                    accounts: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/email'
                        }
                    },
                    endpoint_groups: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        account: {
                            $ref: 'common_api#/definitions/email'
                        },
                        read_count: {
                            type: 'integer'
                        },
                        write_count: {
                            type: 'integer'
                        },
                        read_bytes: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        write_bytes: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

    },

    definitions: {
        account_info: {
            type: 'object',
            required: ['name', 'email', 'has_login', 'has_s3_access'],
            properties: {
                name: { $ref: 'common_api#/definitions/account_name' },
                email: { $ref: 'common_api#/definitions/email' },
                is_support: {
                    type: 'boolean',
                },
                is_external: {
                    type: 'boolean'
                },
                has_login: {
                    type: 'boolean',
                },
                next_password_change: {
                    idate: true,
                },
                access_keys: {
                    type: 'array',
                    items: {
                        $ref: 'common_api#/definitions/access_keys'
                    }
                },
                has_s3_access: {
                    type: 'boolean'
                },
                role_config: {
                    $ref: 'common_api#/definitions/role_config'
                },
                can_create_buckets: {
                    type: 'boolean'
                },
                allowed_ips: {
                    type: 'array',
                    items: {
                        $ref: 'common_api#/definitions/ip_range'
                    }
                },
                default_resource: {
                    type: 'string',
                },
                bucket_claim_owner: {
                    $ref: 'common_api#/definitions/bucket_name',
                },
                external_connections: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'number'
                        },
                        connections: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string'
                                    },
                                    endpoint: {
                                        type: 'string'
                                    },
                                    region: {
                                        type: 'string'
                                    },
                                    identity: { $ref: 'common_api#/definitions/access_key' },
                                    cp_code: {
                                        type: 'string'
                                    },
                                    auth_method: {
                                        $ref: 'common_api#/definitions/cloud_auth_method'
                                    },
                                    endpoint_type: {
                                        $ref: 'common_api#/definitions/endpoint_type'
                                    },
                                    usage: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            required: ['usage_type', 'entity', 'external_entity'],
                                            properties: {
                                                usage_type: {
                                                    type: 'string',
                                                    enum: ['CLOUD_RESOURCE', 'NAMESPACE_RESOURCE']
                                                },
                                                entity: {
                                                    type: 'string'
                                                },
                                                external_entity: {
                                                    type: 'string'
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                systems: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'roles'],
                        properties: {
                            name: {
                                type: 'string'
                            },
                            roles: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                    enum: ['admin', 'user', 'operator']
                                }
                            }
                        }
                    }
                },
                preferences: {
                    type: 'object',
                    required: ['ui_theme'],
                    properties: {
                        ui_theme: {
                            type: 'string',
                            enum: ['DARK', 'LIGHT']
                        }
                    }
                },
                force_md5_etag: {
                    type: 'boolean'
                },
                nsfs_account_config: {
                    $ref: 'common_api#/definitions/nsfs_account_config'
                }
            },
        },

        account_acl: {
            anyOf: [{
                type: 'null'
            }, {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['bucket_name', 'is_allowed'],
                    properties: {
                        bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                        is_allowed: {
                            type: 'boolean'
                        }
                    }
                }
            }]
        }
    }
};
