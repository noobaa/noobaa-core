'use strict';

/**
 *
 * SYSTEM API
 *
 * client (currently web client) talking to the web server to work on system
 * (per client group - contains nodes, tiers abd bckets etc)
 *
 */
module.exports = {

    id: 'system_api',

    methods: {

        create_system: {
            method: 'POST',
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
                required: ['token', 'info'],
                properties: {
                    token: {
                        type: 'string',
                    },
                    info: {
                        $ref: '#/definitions/system_info'
                    },
                }
            },
            auth: {
                system: false,
            }
        },

        read_system: {
            doc: 'Read the info of the authorized system',
            method: 'GET',
            reply: {
                $ref: '#/definitions/system_full_info'
            },
            auth: {
                system: 'admin',
            }
        },

        update_system: {
            doc: 'Update the authorized system',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
            auth: {
                system: 'admin',
            }
        },

        delete_system: {
            doc: 'Delete the authorized system',
            method: 'DELETE',
            auth: {
                system: 'admin',
            }
        },


        list_systems: {
            doc: 'List the systems that the authorized account can access',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['systems'],
                properties: {
                    systems: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/system_info'
                        }
                    }
                }
            },
            auth: {
                system: false,
            }
        },


        add_role: {
            doc: 'Add role',
            method: 'POST',
            params: {
                type: 'object',
                requires: ['role', 'email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    role: {
                        $ref: '#/definitions/role_enum'
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        remove_role: {
            doc: 'Remove role',
            method: 'DELETE',
            params: {
                type: 'object',
                requires: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },


        read_activity_log: {
            method: 'GET',
            params: {
                type: 'object',
                requires: [],
                properties: {
                    event: {
                        type: 'string',
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    till: {
                        type: 'integer',
                        format: 'idate',
                    },
                    since: {
                        type: 'integer',
                        format: 'idate',
                    },
                    skip: {
                        type: 'integer',
                    },
                    limit: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'object',
                requires: ['logs'],
                properties: {
                    logs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            requires: ['id', 'time', 'level', 'event'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                time: {
                                    type: 'integer',
                                    format: 'idate',
                                },
                                level: {
                                    type: 'string',
                                },
                                event: {
                                    type: 'string',
                                },
                                tier: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                node: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                bucket: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                obj: {
                                    type: 'object',
                                    required: ['key'],
                                    properties: {
                                        key: {
                                            type: 'string'
                                        }
                                    }
                                },
                                account: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
                                    }
                                },
                                actor: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
                                    }
                                },
                            }
                        }
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        diagnose: {
            method: 'GET',
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        start_debug: {
            method: 'POST',
            auth: {
                system: 'admin',
            }
        },

        update_n2n_config: {
            method: 'POST',
            params: {
                $ref: 'common_api#/definitions/n2n_config'
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },

        update_base_address: {  
            method: 'POST',
            params: {
                type: 'object',
                required: ['base_address'],
                properties: {
                    base_address: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },

        update_system_certificate: {
            method: 'POST',
            auth: {
                system: 'admin',
            }
        },

        update_hostname: {  
            method: 'POST',
            params: {
                type: 'object',
                required: ['hostname'],
                properties: {
                    hostname: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },        
    },

    definitions: {

        system_info: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
            },
        },


        system_full_info: {
            type: 'object',
            required: [
                'name',
                'roles',
                'tiers',
                'pools',
                'storage',
                'nodes',
                'buckets',
                'objects',
                'access_keys'
            ],
            properties: {
                name: {
                    type: 'string',
                },
                roles: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/role_info'
                    }
                },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: 'tier_api#/definitions/tier_info'
                    }
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                nodes: {
                    $ref: '#/definitions/nodes_info'
                },
                buckets: {
                    type: 'array',
                    items: {
                        $ref: 'bucket_api#/definitions/bucket_info'
                    }
                },
                pools: {
                    type: 'array',
                    items: {
                        $ref: 'pool_api#/definitions/pool_extended_info'
                    },
                },
                objects: {
                    type: 'integer'
                },
                access_keys: {
                    type: 'array',
                    item: {
                        $ref: '#/definitions/access_keys'
                    }
                },
                ssl_port: {
                    type: 'string'
                },
                web_port: {
                    type: 'string'
                },
                web_links: {
                    type: 'object',
                    properties: {
                        agent_installer: {
                            type: 'string',
                        },
                        linux_agent_installer: {
                            type: 'string',
                        },
                        s3rest_installer: {
                            type: 'string',
                        },
                    }
                },
                n2n_config: {
                    $ref: 'common_api#/definitions/n2n_config'
                },
                ip_address: {
                    type: 'string'
                },
                dns_name: {
                    type: 'string'
                },
                base_address: {
                    type: 'string'
                },
                version: {
                    type: 'string'
                },
            }
        },


        role_info: {
            type: 'object',
            required: ['roles', 'account'],
            properties: {
                roles: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/role_enum'
                    }
                },
                account: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                        name: {
                            type: 'string',
                        },
                        email: {
                            type: 'string',
                        },
                    }
                }
            }
        },


        role_enum: {
            enum: ['admin', 'user', 'viewer'],
            type: 'string',
        },

        nodes_info: {
            type: 'object',
            required: ['count', 'online'],
            properties: {
                count: {
                    type: 'integer'
                },
                online: {
                    type: 'integer'
                },
            }
        },

        access_keys: {
            type: 'object',
            required: ['access_key', 'secret_key'],
            peroperties: {
                access_key: {
                    type: String,

                },
                secret_key: {
                    type: String,
                }
            }
        },

        system_nodes_update_reply: {
            type: 'object',
            required: ['nodes_count', 'nodes_updated'],
            properties: {
                nodes_count: {
                    type: 'integer'
                },
                nodes_updated: {
                    type: 'integer'
                }
            }
        }

    }
};
