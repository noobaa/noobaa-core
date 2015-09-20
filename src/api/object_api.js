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
                    etag: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },
        complete_part_upload: {
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
                    upload_part_number: {
                        type: 'integer',
                    },
                    etag: {
                        type: 'string',
                    }
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
                                'chunk',
                                'frags'
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
                                part_sequence_number: {
                                    type: 'integer',
                                },
                                chunk: {
                                    $ref: '/object_api/definitions/chunk_info',
                                },
                                frags: {
                                    type: 'array',
                                    items: {
                                        $ref: '/object_api/definitions/frag_info',
                                    }
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
                                upload_part_number: {
                                    type: 'integer',
                                },
                                part_sequence_number: {
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
                required: [
                    'bucket',
                    'key',
                    'start',
                    'end',
                    'block_id',
                    'is_write'
                ],
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
                    upload_part_number: {
                        type: 'integer',
                    },
                    part_sequence_number: {
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
                        $ref: '/agent_api/definitions/block_md'
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
                    adminfo: {
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
                    key_prefix: {
                        type: 'string',
                    },
                    //filter subdirectories
                    key_s3_prefix: {
                        type: 'string',
                    },
                    key_regexp: {
                        type: 'string',
                    },
                    key_glob: {
                        type: 'string',
                    },
                    key_query: {
                        type: 'string',
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                    pagination: {
                        type: 'boolean'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['objects'],
                properties: {
                    total_count: {
                        type: 'integer'
                    },
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
                    format: 'idate',
                },
                upload_size: {
                    type: 'integer',
                },
                etag: {
                    type: 'string',
                }
            }
        },

        object_part_info: {
            type: 'object',
            required: [
                'start',
                'end',
                'chunk',
                'frags'
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
                part_sequence_number: {
                    type: 'integer',
                },
                chunk_offset: {
                    type: 'integer',
                },
                chunk: {
                    $ref: '/object_api/definitions/chunk_info',
                },
                // the fragments composing the data chunk
                frags: {
                    type: 'array',
                    items: {
                        $ref: '/object_api/definitions/frag_info',
                    }
                }
            }
        },

        chunk_info: {
            type: 'object',
            required: [
                'size',
                'digest_type',
                'digest_b64',
                'cipher_type',
                'cipher_key_b64',
                'data_frags',
                'lrc_frags'
            ],
            properties: {
                size: {
                    type: 'integer',
                },
                digest_type: {
                    type: 'string',
                },
                digest_b64: {
                    type: 'string',
                },
                compress_type: {
                    type: 'string',
                },
                compress_size: {
                    type: 'integer',
                },
                cipher_type: {
                    type: 'string',
                },
                cipher_key_b64: {
                    type: 'string',
                },
                cipher_iv_b64: {
                    type: 'string',
                },
                cipher_auth_tag_b64: {
                    type: 'string',
                },
                data_frags: {
                    type: 'integer',
                },
                lrc_frags: {
                    type: 'integer',
                },
                adminfo: {
                    type: 'object',
                    required: ['health'],
                    properties: {
                        health: {
                            type: 'string'
                        }
                    }
                },
            }
        },

        frag_info: {
            type: 'object',
            required: [
                'layer',
                'frag',
                'digest_type',
                'digest_b64'
            ],
            properties: {
                layer: {
                    type: 'string'
                },
                layer_n: {
                    type: 'integer'
                },
                frag: {
                    type: 'integer'
                },
                digest_type: {
                    type: 'string'
                },
                digest_b64: {
                    type: 'string'
                },
                adminfo: {
                    type: 'object',
                    required: ['health'],
                    properties: {
                        health: {
                            type: 'string'
                        }
                    }
                },
                blocks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['block_md'],
                        properties: {
                            block_md: {
                                $ref: '/agent_api/definitions/block_md'
                            },
                            adminfo: {
                                type: 'object',
                                required: ['tier_name', 'node_name'],
                                properties: {
                                    tier_name: {
                                        type: 'string',
                                    },
                                    node_name: {
                                        type: 'string',
                                    },
                                    node_ip: {
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
                    }
                }
            }
        },
    },

};
