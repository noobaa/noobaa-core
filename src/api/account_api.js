'use strict';

/**
 *
 * ACCOUNT API
 *
 * admin on web client sends commands to web server
 *
 */
module.exports = {

    name: 'account_api',

    methods: {

        create_account: {
            doc: 'Create a new account',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'email', 'password'],
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
            reply: {
                $ref: '/definitions/account_api/account_info'
            },
            auth: {
                system: false,
            }
        },

        update_account: {
            doc: 'Update the info of the authorized account',
            method: 'PUT',
            params: {
                type: 'object',
                required: [],
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
                    original_email: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: false,
            }
        },

        delete_account: {
            doc: 'Delete the authorized account',
            method: 'DELETE',
            auth: {
                system: false,
            }
        },

        list_accounts: {
            doc: 'List accounts',
            method: 'GET',
            reply: {
                type: 'object',
                require: 'accounts',
                properties: {
                    accounts: {
                        type: 'array',
                        items: {
                            $ref: '/definitions/account_api/account_info'
                        }
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        //currently the same as list_accounts.
        list_system_accounts: {
            doc: 'List accounts',
            method: 'GET',
            reply: {
                type: 'object',
                require: 'accounts',
                properties: {
                    accounts: {
                        type: 'array',
                        items: {
                            $ref: '/definitions/account_api/account_info'
                        }
                    }
                }
            },
            auth: {
                system: false,
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
