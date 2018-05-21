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
                required: ['obj_id', 'chunk_split_config', 'chunk_coder_config'],
                properties: {
                    obj_id: { objectid: true },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
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
                    'obj_id',
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true,
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
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
                    md_conditions: {
                        $ref: '#/definitions/md_conditions',
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
                    'obj_id',
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true,
                    },
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

        create_multipart: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'obj_id',
                    'bucket',
                    'key',
                    'num'
                ],
                properties: {
                    obj_id: {
                        objectid: true,
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
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
                required: ['multipart_id', 'chunk_split_config', 'chunk_coder_config'],
                properties: {
                    multipart_id: { objectid: true },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
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
                    'obj_id',
                    'bucket',
                    'key',
                    'num',
                    'multipart_id',
                    'size',
                    'md5_b64',
                    'num_parts',
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    num: {
                        type: 'integer',
                    },
                    multipart_id: {
                        objectid: true
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
                    etag: {
                        type: 'string',
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
                        idate: true
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
                    'obj_id',
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
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
                                    idate: true
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
                    'obj_id',
                    'bucket',
                    'key',
                    'parts'
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
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
                    'obj_id',
                    'bucket',
                    'key',
                    'parts'
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
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

        read_object_mappings: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    // 'obj_id',
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
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
                    }
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
                                obj_id: {
                                    objectid: true
                                },
                                upload_started: {
                                    idate: true
                                },
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


        read_host_mappings: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
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
                                obj_id: {
                                    objectid: true
                                },
                                upload_started: {
                                    idate: true
                                },
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
                required: [
                    // 'obj_id',
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    md_conditions: {
                        $ref: '#/definitions/md_conditions',
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
                required: [
                    'bucket',
                    'key'
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
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
                required: [
                    'bucket',
                    'key',
                ],
                properties: {
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    md_conditions: {
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
                    upload_id_marker: {
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
                            $ref: '#/definitions/object_info'
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
                    },
                    next_upload_id_marker: {
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
                type: 'object',
                required: ['objects'],
                properties: {
                    counters: {
                        type: 'object',
                        properties: {
                            by_mode: {
                                type: 'object',
                                properties: {
                                    completed: {
                                        type: 'integer'
                                    },
                                    uploading: {
                                        type: 'integer'
                                    },
                                }
                            },
                            non_paginated: {
                                type: 'integer'
                            },
                        }
                    },
                    objects: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/object_info'
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
                    obj_id: {
                        objectid: true
                    },
                    bucket: {
                        type: 'string'
                    },
                    key: {
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

        report_endpoint_problems: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'problem',
                ],
                properties: {
                    problem: {
                        enum: ['STRESS'],
                        type: 'string'
                    },
                    node_id: {
                        objectid: true
                    },
                    host_id: {
                        type: 'string'
                    }
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        add_endpoint_usage_report: {
            method: 'PUT',
            params: {
                type: 'object',
                properties: {
                    start_time: {
                        idate: true,
                    },
                    end_time: {
                        idate: true,
                    },
                    s3_usage_info: {
                        $ref: '#/definitions/s3_usage_info',
                    },
                    s3_errors_info: {
                        $ref: '#/definitions/s3_errors_info'
                    },
                    bandwidth_usage_info: {
                        $ref: '#/definitions/bandwidth_usage_info'
                    }
                }
            },
            auth: {
                system: ['admin']
            }
        },

        remove_endpoint_usage_reports: {
            method: 'DELETE',
            auth: {
                system: 'admin',
            }
        },

        read_endpoint_usage_report: {
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
                        idate: true,
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_bucket_read_counters: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_bucket_write_counters: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        }

    },

    definitions: {

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
                    objectid: true
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
                    idate: true
                },
                upload_started: {
                    idate: true
                },
                upload_size: {
                    type: 'integer',
                },
                etag: {
                    type: 'string',
                },
                md5_b64: {
                    type: 'string',
                },
                sha256_b64: {
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
                            idate: true,
                        }
                    }
                },
                num_parts: {
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
                    objectid: true
                },
                chunk_offset: {
                    type: 'integer',
                },
                chunk: {
                    $ref: '#/definitions/chunk_info',
                },
                chunk_id: {
                    objectid: true
                },
            }
        },

        chunk_info: {
            type: 'object',
            required: [
                'size',
                'frags'
            ],
            properties: {
                chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                size: { type: 'integer' },
                frag_size: { type: 'integer' },
                compress_size: { type: 'integer' },
                digest_b64: { type: 'string' },
                cipher_key_b64: { type: 'string' },
                cipher_iv_b64: { type: 'string' },
                cipher_auth_tag_b64: { type: 'string' },
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
            properties: {
                data_index: { type: 'integer' },
                parity_index: { type: 'integer' },
                lrc_index: { type: 'integer' },
                digest_b64: { type: 'string' },
                blocks: {
                    type: 'array',
                    items: { $ref: '#/definitions/block_info' }
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
                    required: ['pool_name', 'node_name', 'node_ip', 'online', 'accessible'],
                    properties: {
                        node_name: {
                            type: 'string',
                        },
                        host_name: {
                            type: 'string',
                        },
                        mount: {
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
                        accessible: {
                            type: 'boolean'
                        },
                        in_cloud_pool: {
                            type: 'boolean'
                        },
                        in_mongo_pool: {
                            type: 'boolean'
                        },
                        mirror_group: { type: 'string' }
                    }
                }
            }
        },

        // metadata if's - conditions to use metadata
        md_conditions: {
            type: 'object',
            properties: {
                if_modified_since: {
                    idate: true
                },
                if_unmodified_since: {
                    idate: true
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
        },

        bandwidth_usage_info: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    bucket: {
                        type: 'string'
                    },
                    access_key: {
                        type: 'string'
                    },
                    read_bytes: {
                        type: 'integer',
                    },
                    write_bytes: {
                        type: 'integer',
                    },
                    read_count: {
                        type: 'integer',
                    },
                    write_count: {
                        type: 'integer',
                    },
                }
            }
        }
    },
};
