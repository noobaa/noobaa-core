// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * OBJECT API
 *
 */
module.exports = rest_api({

    name: 'object_api',

    methods: {

        create_multipart_upload: {
            method: 'POST',
            path: '/obj/:bucket/:key/upload',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'size', 'content_type'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    size: {
                        type: 'integer',
                    },
                    content_type: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        complete_multipart_upload: {
            method: 'PUT',
            path: '/obj/:bucket/:key/upload',
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
            auth: {
                system: ['admin', 'user']
            }
        },

        abort_multipart_upload: {
            method: 'DELETE',
            path: '/obj/:bucket/:key/upload',
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
            auth: {
                system: ['admin', 'user']
            }
        },

        allocate_object_part: {
            method: 'POST',
            path: '/obj/:bucket/:key/part',
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
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        read_object_mappings: {
            method: 'GET',
            path: '/obj/:bucket/:key/map',
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
            },
            auth: {
                system: ['admin', 'user', 'viewer']
            }
        },

        read_object_md: {
            method: 'GET',
            path: '/obj/:bucket/:key',
            params: {
                $ref: '/object_api/definitions/object_path'
            },
            reply: {
                $ref: '/object_api/definitions/object_info'
            },
            auth: {
                system: ['admin', 'user', 'viewer']
            }
        },

        update_object_md: {
            method: 'PUT',
            path: '/obj/:bucket/:key',
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
                    content_type: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_object: {
            method: 'DELETE',
            path: '/obj/:bucket/:key',
            params: {
                $ref: '/object_api/definitions/object_path'
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        list_objects: {
            method: 'GET',
            path: '/objs/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
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
            },
            auth: {
                system: 'admin'
            }
        },

    },



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
            required: ['size', 'content_type', 'create_time'],
            properties: {
                size: {
                    type: 'integer',
                },
                content_type: {
                    type: 'string',
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
