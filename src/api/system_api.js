// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * SYSTEM API
 *
 * client (currently web client) talking to the web server to work on system (per client group - contains nodes, tiers abd bckets etc)
 */
module.exports = rest_api({

    name: 'system_api',

    methods: {

        create_system: {
            method: 'POST',
            path: '/system/',
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
                $ref: '/system_api/definitions/system_info'
            },
            auth: {
                system: false,
            }
        },

        read_system: {
            doc: 'Read the info of the authorized system',
            method: 'GET',
            path: '/system',
            reply: {
                $ref: '/system_api/definitions/system_full_info'
            },
            auth: {
                system: 'admin',
            }
        },

        update_system: {
            doc: 'Update the authorized system',
            method: 'PUT',
            path: '/system',
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
            path: '/system',
            auth: {
                system: 'admin',
            }
        },


        list_systems: {
            doc: 'List the systems that the authorized account can access',
            method: 'GET',
            path: '/systems',
            reply: {
                type: 'object',
                required: ['systems'],
                properties: {
                    systems: {
                        type: 'array',
                        items: {
                            $ref: '/system_api/definitions/system_info'
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
            path: '/role',
            params: {
                type: 'object',
                requires: ['role', 'email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    role: {
                        $ref: '/system_api/definitions/role_enum'
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
            path: '/role/:email',
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
            path: '/activity_log',
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
                        format: 'date',
                    },
                    since: {
                        type: 'integer',
                        format: 'date',
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
                                    format: 'date',
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
                            }
                        }
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        }
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
                'storage',
                'nodes',
                'buckets',
                'objects',
            ],
            properties: {
                name: {
                    type: 'string',
                },
                roles: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/role_info'
                    }
                },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '/tier_api/definitions/tier_info'
                    }
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
                nodes: {
                    $ref: '/system_api/definitions/nodes_info'
                },
                buckets: {
                    type: 'array',
                    items: {
                        $ref: '/bucket_api/definitions/bucket_info'
                    }
                },
                objects: {
                    type: 'integer'
                },
            }
        },


        role_info: {
            type: 'object',
            required: ['role', 'account'],
            properties: {
                role: {
                    $ref: '/system_api/definitions/role_enum'
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


    }
});
