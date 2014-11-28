// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'object_api',

    methods: {

        ///////////////////
        // object upload //
        ///////////////////

        create_multipart_upload: {
            method: 'POST',
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
                        type: 'integer',
                    }
                }
            },
        },

        complete_multipart_upload: {
            method: 'PUT',
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
                required: ['bucket', 'key', 'start', 'end', 'md5sum'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    start: {
                        type: 'integer',
                    },
                    end: {
                        type: 'integer',
                    },
                    md5sum: {
                        type: 'string',
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
                        type: 'integer',
                    },
                    end: {
                        type: 'integer',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['size', 'parts'],
                properties: {
                    size: {
                        type: 'integer'
                    },
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
                    type: 'integer',
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
            required: [
                'start', 'end',
                'kfrag', 'md5sum',
                'chunk_size', 'chunk_offset',
                'fragments'
            ],
            properties: {
                start: {
                    type: 'integer',
                },
                end: {
                    type: 'integer',
                },
                kfrag: {
                    type: 'integer',
                },
                md5sum: {
                    type: 'string',
                },
                chunk_size: {
                    type: 'integer',
                },
                chunk_offset: {
                    type: 'integer',
                },
                fragments: {
                    // the fragments composing the data chunk
                    type: 'array',
                    items: {
                        // each fragment contains an array of blocks
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
                                            type: 'integer',
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
