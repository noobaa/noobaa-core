'use strict';

/**
 *
 * BUCKET API
 *
 * client (currently web client) talking to the web server to work on bucket
 *
 */
module.exports = {

    name: 'bucket_api',

    methods: {

        create_bucket: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'tiering'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    tiering: {
                        $ref: '/bucket_api/definitions/tiering_info'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        read_bucket: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '/bucket_api/definitions/bucket_info'
            },
            auth: {
                system: 'admin'
            }
        },

        update_bucket: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    new_name: {
                        type: 'string',
                    },
                    tiering: {
                        $ref: '/bucket_api/definitions/tiering_info'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_bucket: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        list_buckets: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['buckets'],
                properties: {
                    buckets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                                name: {
                                    type: 'string'
                                },
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

    },


    definitions: {

        bucket_info: {
            type: 'object',
            required: ['name', 'tiering', 'storage', 'num_objects'],
            properties: {
                name: {
                    type: 'string',
                },
                tiering: {
                    $ref: '/bucket_api/definitions/tiering_info'
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
                num_objects: {
                    type: 'integer'
                },
            }
        },

        tiering_info: {
            type: 'array',
            items: {
                type: 'string',
            }
        }

    },

};
