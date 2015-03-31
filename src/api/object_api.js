'use strict';

/**
 *
 * OBJECT API
 *
 * client (currently web client) talking to the web server to work on object
 *
 */
module.exports = {

    name: 'object_api',

    methods: {

        create_multipart_upload: {
            method: 'POST',
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

        list_multipart_parts: {
            method: 'GET',
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
                    part_number_marker: {
                        type: 'integer',
                    },
                    max_parts: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'object',
                required: [
                    'part_number_marker',
                    'max_parts',
                    'is_truncated',
                    'next_part_number_marker',
                    'upload_parts'
                ],
                properties: {
                    part_number_marker: {
                        type: 'integer',
                    },
                    max_parts: {
                        type: 'integer',
                    },
                    is_truncated: {
                        type: 'boolean',
                    },
                    next_part_number_marker: {
                        type: 'integer',
                    },
                    upload_parts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['part_number', 'size'],
                            properties: {
                                part_number: {
                                    type: 'integer'
                                },
                                size: {
                                    type: 'integer'
                                },
                            }
                        }
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        complete_multipart_upload: {
            method: 'PUT',
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
                    fix_parts_size: {
                        type: 'boolean',
                    },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        abort_multipart_upload: {
            method: 'DELETE',
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

        allocate_object_parts: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'parts'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    parts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'start',
                                'end',
                                'chunk_size',
                                'crypt'
                            ],
                            properties: {
                                start: {
                                    type: 'integer',
                                },
                                end: {
                                    type: 'integer',
                                },
                                chunk_size: {
                                    type: 'integer',
                                },
                                crypt: {
                                    $ref: '/object_api/definitions/crypt_info',
                                },
                                upload_part_number: {
                                    type: 'integer',
                                },
                            }
                        }
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['parts'],
                properties: {
                    parts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [],
                            properties: {
                                dedup: {
                                    type: 'boolean'
                                },
                                part: {
                                    $ref: '/object_api/definitions/object_part_info'
                                }
                            }
                        }
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        self_test_to_node_via_web: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['source', 'target', 'request_length', 'response_length'],
                properties: {
                    source: {
                        $ref: '/common_api/definitions/block_address'
                    },
                    target: {
                        $ref: '/common_api/definitions/block_address'
                    },
                    request_length: {
                        type: 'integer'
                    },
                    response_length: {
                        type: 'integer'
                    }
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        finalize_object_parts: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'parts'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    parts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['start', 'end'],
                            properties: {
                                start: {
                                    type: 'integer',
                                },
                                end: {
                                    type: 'integer',
                                },
                                block_ids: {
                                    type: 'array',
                                    items: 'string',
                                },
                            }
                        }
                    }
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        report_bad_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'start', 'end', 'fragment', 'block_id', 'is_write'],
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
                    fragment: {
                        type: 'integer',
                    },
                    block_id: {
                        type: 'string',
                    },
                    is_write: {
                        type: 'boolean',
                    },
                },
            },
            reply: {
                type: 'object',
                required: [],
                properties: {
                    new_block: {
                        $ref: '/common_api/definitions/block_address'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        read_object_mappings: {
            method: 'GET',
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
                    start: {
                        type: 'integer',
                    },
                    end: {
                        type: 'integer',
                    },
                    skip: {
                        type: 'integer',
                    },
                    limit: {
                        type: 'integer',
                    },
                    details: {
                        type: 'boolean',
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
            params: {
                $ref: '/object_api/definitions/object_path'
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        list_objects: {
            method: 'GET',
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
                    key_regexp: {
                        type: 'string',
                    },
                    key_glob: {
                        type: 'string',
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
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
                    type: 'integer',
                    format: 'date',
                },
                upload_size: {
                    type: 'integer',
                }
            }
        },

        object_part_info: {
            type: 'object',
            required: [
                'start',
                'end',
                'kfrag',
                'crypt',
                'chunk_size',
                'chunk_offset',
                'fragments'
            ],
            properties: {
                start: {
                    type: 'integer',
                },
                end: {
                    type: 'integer',
                },
                upload_part_number: {
                    type: 'integer',
                },
                kfrag: {
                    type: 'integer',
                },
                crypt: {
                    $ref: '/object_api/definitions/crypt_info',
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
                        type: 'object',
                        required: ['blocks'],
                        properties: {
                            blocks: {
                                type: 'array',
                                items: {
                                    $ref: '/object_api/definitions/object_block_info'
                                }
                            },
                            details: {
                                type: 'object',
                                required: ['health'],
                                properties: {
                                    health: {
                                        type: 'string'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        object_block_info: {
            type: 'object',
            required: ['address'],
            properties: {
                address: {
                    $ref: '/common_api/definitions/block_address'
                },
                details: {
                    type: 'object',
                    required: ['tier_name', 'node_name'],
                    properties: {
                        tier_name: {
                            type: 'string',
                        },
                        node_name: {
                            type: 'string',
                        },
                        srvmode: {
                            $ref: '/node_api/definitions/srvmode'
                        },
                        online: {
                            type: 'boolean'
                        },
                        building: {
                            type: 'boolean',
                        }
                    }
                }
            }
        },

        crypt_info: {
            type: 'object',
            required: [
                'hash_type',
                'hash_val',
                'cipher_type',
                'cipher_val'
            ],
            properties: {
                hash_type: {
                    type: 'string',
                },
                hash_val: {
                    type: 'string',
                },
                cipher_type: {
                    type: 'string',
                },
                cipher_val: {
                    type: 'string',
                },
            }
        }

    },

};
