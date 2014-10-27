// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'object_api',

    methods: {

        // bucket functions

        create_bucket: {
            method: 'POST',
            path: '/',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    }
                }
            }
        },

        read_bucket: {
            method: 'GET',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                }
            }
        },

        update_bucket: {
            method: 'PUT',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
        },

        delete_bucket: {
            method: 'DELETE',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
        },

        list_bucket_objects: {
            method: 'GET',
            path: '/:bucket/list',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['objects'],
                properties: {
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['key', 'info'],
                            properties: {
                                key: {
                                    type: 'string',
                                },
                                info: {
                                    $ref: '/object_api/definitions/object_info'
                                }
                            }
                        }
                    }
                }
            }
        },


        ///////////////////
        // object upload //
        ///////////////////

        create_multipart_upload: {
            method: 'POST',
            path: '/:bucket/:key/upload',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        complete_multipart_upload: {
            method: 'PUT',
            path: '/:bucket/:key/upload',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'size'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    size: {
                        type: 'number',
                    }
                }
            },
        },

        abort_multipart_upload: {
            method: 'DELETE',
            path: '/:bucket/:key/upload',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        allocate_object_part: {
            method: 'POST',
            path: '/:bucket/:key/part',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'start', 'end'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    start: {
                        type: 'number',
                    },
                    end: {
                        type: 'number',
                    },
                },
            },
            reply: {
                $ref: '/object_api/definitions/object_part_info'
            }
        },


        //////////////////////
        // object meta-data //
        //////////////////////

        read_object_md: {
            method: 'GET',
            path: '/:bucket/:key',
            params: {
                $ref: '/object_api/definitions/object_path'
            },
            reply: {
                $ref: '/object_api/definitions/object_info'
            }
        },

        update_object_md: {
            method: 'PUT',
            path: '/:bucket/:key',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        delete_object: {
            method: 'DELETE',
            path: '/:bucket/:key',
            params: {
                $ref: '/object_api/definitions/object_path'
            },
        },


        read_object_mappings: {
            method: 'GET',
            path: '/:bucket/:key/map',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'start', 'end'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    start: {
                        type: 'number',
                    },
                    end: {
                        type: 'number',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['parts'],
                properties: {
                    parts: {
                        type: 'array',
                        items: {
                            $ref: '/object_api/definitions/object_part_info'
                        },
                    },
                }
            }
        },

    },



    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        object_path: {
            type: 'object',
            required: ['bucket', 'key'],
            properties: {
                bucket: {
                    type: 'string',
                },
                key: {
                    type: 'string',
                },
            }
        },

        object_info: {
            type: 'object',
            required: ['size', 'create_time'],
            properties: {
                size: {
                    type: 'number',
                },
                create_time: {
                    type: 'string',
                    format: 'date',
                },
                upload_mode: {
                    type: 'boolean',
                }
            }
        },

        object_part_info: {
            type: 'object',
            required: ['start', 'end', 'kblocks', 'chunk_size', 'chunk_offset', 'indexes'],
            properties: {
                start: {
                    type: 'number',
                },
                end: {
                    type: 'number',
                },
                kblocks: {
                    type: 'number',
                },
                chunk_size: {
                    type: 'number',
                },
                chunk_offset: {
                    type: 'number',
                },
                indexes: {
                    // the indexes composing the data chunk
                    type: 'array',
                    items: {
                        // each index contains an array of blocks
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'node'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                node: {
                                    type: 'object',
                                    required: ['id', 'ip', 'port'],
                                    properties: {
                                        id: {
                                            type: 'string',
                                        },
                                        ip: {
                                            type: 'string',
                                        },
                                        port: {
                                            type: 'number',
                                        },
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

    },

});
