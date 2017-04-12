/* Copyright (C) 2016 NooBaa */
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
                    content_type: {
                        type: 'string',
                    },
                    xattr: {
                        $ref: '#/definitions/xattr',
                    },
                    overwrite_if: {
                        // conditions on target key if exists
                        $ref: '#/definitions/md_conditions',
                    },
                    size: {
                        type: 'integer',
                    },
                    md5_b64: {
                        type: 'string'
                    },
                    sha256_b64: {
                        type: 'string'
                    },
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
                    size: {
                        type: 'integer',
                    },
                    md5_b64: {
                        type: 'string'
                    },
                    sha256_b64: {
                        type: 'string'
                    },
                    num_parts: {
                        type: 'integer',
                    },
                    etag: {
                        type: 'string',
                    },
                    multiparts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['num', 'etag'],
                            properties: {
                                num: {
                                    type: 'integer'
                                },
                                etag: {
                                    type: 'string'
                                },
                            }
                        }
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

        create_multipart: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id',
                    'num'
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
                    num: {
                        type: 'integer',
                    },
                    size: {
                        type: 'integer',
                    },
                    md5_b64: {
                        type: 'string'
                    },
                    sha256_b64: {
                        type: 'string'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['multipart_id'],
                properties: {
                    multipart_id: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        complete_multipart: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'upload_id',
                    'num',
                    'multipart_id',
                    'size',
                    'md5_b64',
                    'num_parts',
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
                    num: {
                        type: 'integer',
                    },
                    multipart_id: {
                        type: 'string',
                    },
                    size: {
                        type: 'integer',
                    },
                    md5_b64: {
                        type: 'string'
                    },
                    sha256_b64: {
                        type: 'string'
                    },
                    num_parts: {
                        type: 'integer'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['etag', 'create_time'],
                properties: {
                    etag: {
                        type: 'string'
                    },
                    create_time: {
                        format: 'idate'
                    },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        list_multiparts: {
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
                    max: {
                        type: 'integer',
                    },
                    num_marker: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'object',
                required: [
                    'is_truncated',
                    'multiparts',
                ],
                properties: {
                    is_truncated: {
                        type: 'boolean',
                    },
                    next_num_marker: {
                        type: 'integer',
                    },
                    multiparts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'num',
                                'size',
                                'etag',
                                'last_modified',
                            ],
                            properties: {
                                num: {
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
                required: ['object_md', 'parts'],
                properties: {
                    object_md: {
                        $ref: '#/definitions/object_info'
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

        read_node_mappings: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    by_host: { // get mappings for all nodes in host
                        type: 'boolean'
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                    adminfo: {
                        type: 'boolean'
                    }
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
                            // required: [],
                            properties: {
                                key: {
                                    type: 'string'
                                },
                                bucket: {
                                    type: 'string'
                                },
                                parts: {
                                    type: 'array',
                                    items: {
                                        $ref: '#/definitions/part_info'
                                    }
                                }
                            }
                        }
                    },
                    total_count: {
                        type: 'number'
                    }
                }
            },
            auth: {
                system: 'admin'
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
                    adminfo: {
                        type: 'object',
                        properties: {
                            signed_url_endpoint: {
                                type: 'string'
                            },
                        }
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
                type: 'object',
                required: ['bucket', 'key'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    delete_if: {
                        $ref: '#/definitions/md_conditions',
                    },
                }
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

        list_objects_s3: {
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
                    key_marker: {
                        type: 'string',
                    },
                    limit: {
                        type: 'integer'
                    },
                    upload_mode: {
                        type: 'boolean'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['objects', 'is_truncated'],
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
                    },
                    is_truncated: {
                        type: 'boolean'
                    },
                    next_marker: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
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
                    prefix: {
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
                        enum: ['state', 'key', 'size', 'create_time']
                    },
                    order: {
                        type: 'integer',
                    },
                    upload_mode: {
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
                                    $ref: '#/definitions/object_info'
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

        report_error_on_object: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'action',
                    'bucket',
                    'key'
                ],
                properties: {
                    action: {
                        type: 'string',
                        enum: ['read', 'upload']
                    },
                    bucket: {
                        type: 'string'
                    },
                    key: {
                        type: 'string'
                    },
                    upload_id: {
                        type: 'string'
                    },
                    start: {
                        type: 'integer',
                    },
                    end: {
                        type: 'integer',
                    },
                    blocks_report: {
                        $ref: 'common_api#/definitions/blocks_report'
                    },
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        add_s3_usage_report: {
            method: 'PUT',
            params: {
                type: 'object',
                properties: {
                    s3_usage_info: {
                        $ref: '#/definitions/s3_usage_info',
                    },
                    s3_errors_info: {
                        $ref: '#/definitions/s3_errors_info'
                    },
                }
            },
            auth: {
                system: ['admin']
            }
        },

        remove_s3_usage_reports: {
            method: 'DELETE',
            auth: {
                system: 'admin',
            }
        },

        read_s3_usage_report: {
            method: 'GET',
            reply: {
                type: 'object',
                properties: {
                    s3_usage_info: {
                        $ref: '#/definitions/s3_usage_info',
                    },
                    s3_errors_info: {
                        $ref: '#/definitions/s3_errors_info'
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        delete_multiple_objects_by_prefix: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket', 'prefix'],
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    prefix: {
                        type: 'string',
                    },
                    create_time: {
                        format: 'idate',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },



    definitions: {

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
                'obj_id',
                'bucket',
                'key',
                'size',
                'content_type'
            ],
            properties: {
                obj_id: {
                    type: 'string'
                },
                bucket: {
                    type: 'string'
                },
                key: {
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
                upload_started: {
                    format: 'idate'
                },
                upload_size: {
                    type: 'integer',
                },
                etag: {
                    type: 'string',
                },
                cloud_synced: {
                    type: 'boolean'
                },
                xattr: {
                    $ref: '#/definitions/xattr',
                },
                stats: {
                    type: 'object',
                    properties: {
                        reads: {
                            type: 'integer',
                        },
                        last_read: {
                            format: 'idate',
                        }
                    }
                },
                total_parts_count: {
                    type: 'integer',
                },
                // This is the physical size (aggregation of all blocks)
                // It does not pay attention to dedup
                capacity_size: {
                    type: 'integer',
                },
                s3_signed_url: {
                    type: 'string'
                }
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
                seq: {
                    type: 'integer',
                },
                multipart_id: {
                    type: 'string',
                },
                chunk_offset: {
                    type: 'integer',
                },
                chunk: {
                    $ref: '#/definitions/chunk_info',
                },
                chunk_id: {
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
                    $ref: 'common_api#/definitions/block_md'
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
                        in_cloud_pool: {
                            type: 'boolean'
                        },
                        in_mongo_pool: {
                            type: 'boolean'
                        }
                    }
                }
            }
        },

        s3_usage_info: {
            type: 'object',
            patternProperties: {
                ".+": {
                    type: 'integer'
                }
            }
        },

        s3_errors_info: {
            type: 'object',
            patternProperties: {
                ".+": {
                    type: 'integer'
                }
            }
        }
    },
};
