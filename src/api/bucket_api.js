// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * BUCKET API
 *
 * client (currently web client) talking to the web server to work on bucket
 */
module.exports = rest_api({

    name: 'bucket_api',

    methods: {

        create_bucket: {
            method: 'POST',
            path: '/bucket',
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
            path: '/bucket/:name',
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
            path: '/bucket/:name',
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
            path: '/bucket/:name',
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
            path: '/buckets',
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

});
