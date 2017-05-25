/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * ACCOUNT API
 *
 * admin on web client sends commands to web server
 *
 */
module.exports = {

    id: 'account_api',

    methods: {

        create_account: {
            doc: 'Create a new account',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'email', 'password', 's3_access'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
                    must_change_password: {
                        type: 'boolean',
                    },
                    s3_access: {
                        type: 'boolean'
                    },
                    allowed_buckets: {
                        type: 'array',
                        items: {
                            type: 'string',
                        }
                    },
                    default_pool: {
                        type: 'string',
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
                            allowed_buckets: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                }
                            },
                            default_pool: {
                                type: 'string',
                            },
                        },
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
            }
        },


        read_account: {
            doc: 'Read the info of the authorized account',
            method: 'GET',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/account_info'
            },
            auth: {
                system: false
            }
        },

        update_account: {
            doc: 'Update the info of the authorized account',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                    must_change_password: {
                        type: 'boolean',
                    },
                    new_email: {
                        type: 'string',
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
                    email: {
                        type: 'string',
                    },
                    verification_password: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
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
                required: ['email', 'verification_password'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    verification_password: {
                        type: 'string'
                    }
                },
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
                    email: {
                        type: 'string',
                    },
                    s3_access: {
                        type: 'boolean'
                    },
                    allowed_buckets: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    default_pool: {
                        type: 'string'
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

        update_account_ip_access: {
            doc: 'Update account ip access permissions',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    ips: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

        validate_ip_permission: {
            doc: 'Validate that ip allowed to access',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['access_key', 'ip'],
                properties: {
                    access_key: {
                        type: 'string',
                    },
                    ip: {
                        type: 'string',
                    }
                },
            },
            auth: {
                system: false
            }
        },

        delete_account: {
            doc: 'Delete a given account',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        list_accounts: {
            doc: 'List accounts',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['accounts'],
                properties: {
                    accounts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/account_info'
                        }
                    }
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
            }
        },

        add_external_connection: {
            doc: 'Add a connection to authorized account\'s connections cache',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'identity', 'secret', 'endpoint', 'endpoint_type'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    endpoint: {
                        type: 'string'
                    },
                    identity: {
                        type: 'string'
                    },
                    secret: {
                        type: 'string'
                    },
                    endpoint_type: {
                        type: 'string',
                        enum: ['AWS', 'AZURE', 'S3_COMPATIBLE']
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
                required: ['identity', 'secret', 'endpoint'],
                properties: {
                    endpoint: {
                        type: 'string'
                    },
                    identity: {
                        type: 'string'
                    },

                    secret: {
                        type: 'string'
                    },

                    endpoint_type: {
                        type: 'string',
                        enum: ['AWS', 'AZURE', 'S3_COMPATIBLE']
                    }
                }
            },
            reply: {
                type: 'string',
                enum: ['SUCCESS', 'INVALID_CREDENTIALS', 'NOT_SUPPORTED']
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
        }
    },


    definitions: {
        account_info: {
            type: 'object',
            required: ['name', 'email'],
            properties: {
                name: {
                    type: 'string',
                },
                email: {
                    type: 'string',
                },
                is_support: {
                    type: 'boolean',
                },
                next_password_change: {
                    format: 'idate',
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
                allowed_buckets: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                allowed_ips: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                default_pool: {
                    type: 'string',
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
                                    identity: {
                                        type: 'string'
                                    },
                                    endpoint_type: {
                                        type: 'string',
                                        enum: ['AWS', 'AZURE', 'S3_COMPATIBLE']
                                    },
                                    usage: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            required: ['usage_type', 'entity', 'external_entity'],
                                            properties: {
                                                usage_type: {
                                                    type: 'string',
                                                    enum: ['CLOUD_POOL', 'CLOUD_SYNC']
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
                                    enum: ['admin', 'user', 'viewer']
                                }
                            }
                        }
                    }
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
                        bucket_name: {
                            type: 'string'
                        },
                        is_allowed: {
                            type: 'boolean'
                        }
                    }
                }
            }]
        }
    }
};
