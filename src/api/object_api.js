'use strict';

/**
 *
 * OBJECT API
 *
 * client (currently web client) talking to the web server to work on object
 *
 */
module.exports = {

    id: 'object_api',

    methods: {

        create_object_upload: {
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                ],
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
                    xattr: {
                        $ref: '#/definitions/xattr',
                    },
                    overwrite_if: {
                        // conditions on target key if exists
                        $ref: '#/definitions/md_conditions',
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['upload_id'],
                properties: {
                    upload_id: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        complete_object_upload: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
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
            reply: {
                type: 'object',
                required: ['etag'],
                properties: {
                    etag: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        abort_object_upload: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
                        type: 'string',
                    }
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
                required: [
                    'bucket',
                    'key',
                    'upload_id'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
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
                            required: ['part_number', 'size', 'etag', 'last_modified'],
                            properties: {
                                part_number: {
                                    type: 'integer'
                                },
                                size: {
                                    type: 'integer'
                                },
                                etag: {
                                    type: 'string'
                                },
                                last_modified: {
                                    format: 'idate'
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

        complete_part_upload: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id',
                    'upload_part_number',
                    'etag'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
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

        allocate_object_parts: {
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id',
                    'parts'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
                        type: 'string',
                    },
                    parts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/part_info'
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
                            $ref: '#/definitions/part_info'
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
                required: [
                    'bucket',
                    'key',
                    'upload_id',
                    'parts'
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    upload_id: {
                        type: 'string',
                    },
                    parts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/part_info'
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
                // required: [],
                properties: {
                    new_block: {
                        $ref: 'agent_api#/definitions/block_md'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        copy_object: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'source_bucket',
                    'source_key',
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    source_bucket: {
                        type: 'string'
                    },
                    source_key: {
                        type: 'string'
                    },
                    content_type: {
                        type: 'string',
                    },
                    xattr: {
                        $ref: '#/definitions/xattr',
                    },
                    xattr_copy: {
                        type: 'boolean'
                    },
                    overwrite_if: {
                        // conditions on target key if exists
                        $ref: '#/definitions/md_conditions',
                    },
                    source_if: {
                        // conditions on source key
                        $ref: '#/definitions/md_conditions',
                    }
                }
            },
            reply: {
                type: 'object',
                // required: [],
                properties: {
                    source_md: {
                        $ref: '#/definitions/object_info'
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
                            $ref: '#/definitions/part_info'
                        },
                    },
                    total_parts: {
                        type: 'integer'
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
                type: 'object',
                required: ['bucket', 'key'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    get_parts_count: {
                        type: 'boolean'
                    },
                }
            },
            reply: {
                $ref: '#/definitions/object_info'
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
                    xattr: {
                        $ref: '#/definitions/xattr',
                    }

                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_object: {
            method: 'DELETE',
            params: {
                $ref: '#/definitions/object_path'
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_multiple_objects: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'keys',
                ],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    keys: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
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
                    delimiter: {
                        type: 'string',
                    },
                    prefix: {
                        type: 'string',
                    },
                    key_prefix: {
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
                    sort: {
                        type: 'string',
                        enum: ['state', 'name', 'size']
                    },
                    order: {
                        type: 'integer',
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
                                    $ref: '#/definitions/object_info'
                                }
                            }
                        }
                    },
                    common_prefixes: {
                        type: 'array',
                        items: {
                            type: 'string'
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

        // metadata if's - conditions to use metadata
        md_conditions: {
            type: 'object',
            properties: {
                if_modified_since: {
                    format: 'idate'
                },
                if_unmodified_since: {
                    format: 'idate'
                },
                if_match_etag: {
                    type: 'string'
                },
                if_none_match_etag: {
                    type: 'string'
                },
            }
        },

        // free form object
        xattr: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        },

        object_info: {
            type: 'object',
            required: [
                'size',
                'content_type',
                'create_time'
            ],
            properties: {
                version_id: {
                    type: 'string'
                },
                size: {
                    type: 'integer',
                },
                content_type: {
                    type: 'string',
                },
                create_time: {
                    format: 'idate'
                },
                upload_size: {
                    type: 'integer',
                },
                etag: {
                    type: 'string',
                },
                xattr: {
                    $ref: '#/definitions/xattr',
                },
                stats: {
                    type: 'object',
                    properties: {
                        reads: {
                            type: 'integer',
                        }
                    }
                },
                total_parts_count: {
                    type: 'integer',
                },
            }
        },

        part_info: {
            type: 'object',
            required: [
                'start',
                'end'
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
                    $ref: '#/definitions/chunk_info',
                },
                chunk_dedup: {
                    type: 'string',
                },
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
                'lrc_frags',
                'frags'
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
                frags: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/frag_info',
                    }
                },
                adminfo: {
                    type: 'object',
                    required: ['health'],
                    properties: {
                        health: {
                            enum: ['available', 'building', 'unavailable'],
                            type: 'string'
                        }
                    }
                },
            }
        },

        frag_info: {
            type: 'object',
            required: [
                'size',
                'layer',
                'frag',
                'digest_type',
                'digest_b64'
            ],
            properties: {
                size: {
                    type: 'integer'
                },
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
                blocks: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/block_info'
                    }
                },
            }
        },

        block_info: {
            type: 'object',
            required: ['block_md'],
            properties: {
                block_md: {
                    $ref: 'agent_api#/definitions/block_md'
                },
                adminfo: {
                    type: 'object',
                    required: ['pool_name', 'node_name', 'node_ip', 'online'],
                    properties: {
                        node_name: {
                            type: 'string',
                        },
                        pool_name: {
                            type: 'string'
                        },
                        node_ip: {
                            type: 'string',
                        },
                        online: {
                            type: 'boolean'
                        },
                        srvmode: {
                            $ref: 'node_api#/definitions/srvmode'
                        },
                    }
                }
            }
        },


    },

};
