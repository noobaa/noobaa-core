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
                required: ['name', 'email', 'password', 'access_keys'],
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
                    access_keys: {
                        type: 'object',
                        properties: {
                            access_key: {
                                type: 'string'
                            },
                            secret_key: {
                                type: 'string'
                            }
                        }
                    },
                    allowed_buckets: {
                        type: 'array',
                        items: {
                            type: 'string',
                        }
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
                    password: {
                        type: 'string',
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

        generate_account_keys: {
            doc: 'Generate new account keys',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    }
                },
            },
            reply: {
                type: 'array',
                items: {
                    $ref: 'system_api#/definitions/access_keys'
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_buckets_permissions: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        bucket_name: {
                            type: 'string'
                        },
                        is_allowed: {
                            type: 'boolean'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_buckets_permissions: {
            doc: 'Update bucket access permissions',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['email', 'allowed_buckets'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    allowed_buckets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                bucket_name: {
                                    type: 'string'
                                },
                                is_allowed: {
                                    type: 'boolean'
                                }
                            }
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

        add_account_sync_credentials_cache: {
            doc: 'Update the credentials cache of the authorized account',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'access_key', 'secret_key', 'endpoint'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    endpoint: {
                        type: 'string'
                    },
                    access_key: {
                        type: 'string'
                    },
                    secret_key: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_account_sync_credentials_cache: {
            method: 'GET',
            reply: {
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
                        access_key: {
                            type: 'string'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        check_account_sync_credentials: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['access_key', 'secret_key', 'endpoint'],
                properties: {
                    endpoint: {
                        type: 'string'
                    },
                    access_key: {
                        type: 'string'
                    },

                    secret_key: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'boolean'
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
                access_keys: {
                    type: 'array',
                    items: {
                        $ref: 'system_api#/definitions/access_keys'
                    }
                },
                has_allowed_buckets: {
                    type: 'boolean'
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
        }

    }

};
