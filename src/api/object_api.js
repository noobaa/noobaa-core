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

    $id: 'object_api',

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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    content_type: {
                        type: 'string',
                    },
                    content_encoding: {
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
                    tagging: {
                        $ref: 'common_api#/definitions/tagging'
                    },
                    encryption: {
                        $ref: 'common_api#/definitions/object_encryption'
                    },
                    lock_settings: {
                        $ref: 'common_api#/definitions/lock_settings'
                    },
                    etag: {
                        type: 'string'
                    },
                    complete_upload: {
                        type: 'boolean'
                    },
                    last_modified_time: {
                        idate: true
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['obj_id', 'chunk_split_config', 'chunk_coder_config'],
                properties: {
                    obj_id: { objectid: true },
                    bucket_id: { objectid: true },
                    tier_id: { objectid: true },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                    bucket_master_key_id: { objectid: true },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        get_upload_object_range_info: {
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'obj_id',
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    obj_id: { objectid: true },
                    start: { type: 'integer' },
                    end: { type: 'integer' },
                }
            },
            reply: {
                type: 'object',
                required: ['obj_id', 'chunk_split_config', 'chunk_coder_config', 'tier_id'],
                properties: {
                    obj_id: { objectid: true },
                    bucket_id: { objectid: true },
                    tier_id: { objectid: true },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                    upload_size: { type: 'integer' },
                    bucket_master_key_id: { objectid: true }
                }
            },
            auth: { system: ['admin'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
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
                    },
                    last_modified_time: {
                        idate: true
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['etag'],
                properties: {
                    etag: { type: 'string' },
                    version_id: { type: 'string' },
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                    content_type: { type: 'string' },
                    content_encoding: { type: 'string' },
                    size: { type: 'integer' },
                }
            },
            auth: { system: ['admin', 'user'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                }
            },
            auth: { system: ['admin', 'user'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                }
            },
            reply: {
                type: 'object',
                required: ['multipart_id', 'chunk_split_config', 'chunk_coder_config'],
                properties: {
                    multipart_id: { objectid: true },
                    bucket_id: { objectid: true },
                    tier_id: { objectid: true },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                    bucket_master_key_id: { objectid: true }
                }
            },
            auth: { system: ['admin', 'user'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
                    encryption: { $ref: 'common_api#/definitions/object_encryption' }
                }
            },
            auth: { system: ['admin', 'user'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
            auth: { system: ['admin', 'user'] }
        },

        get_mapping: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['chunks'],
                properties: {
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' }
                    },
                    location_info: { $ref: 'common_api#/definitions/location_info' },
                    move_to_tier: { objectid: true },
                    check_dups: { type: 'boolean' },
                },
            },
            reply: {
                type: 'object',
                required: ['chunks'],
                properties: {
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' }
                    }
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        put_mapping: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['chunks'],
                properties: {
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' }
                    },
                    location_info: { $ref: 'common_api#/definitions/location_info' },
                    move_to_tier: { objectid: true },
                },
            },
            auth: { system: ['admin', 'user'] }
        },

        copy_object_mapping: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['obj_id', 'copy_source'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    obj_id: { objectid: true },
                    multipart_id: { objectid: true },
                    copy_source: {
                        type: 'object',
                        required: ['obj_id'],
                        properties: {
                            obj_id: { objectid: true },
                            start: { type: 'integer' },
                            end: { type: 'integer' },
                        }
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['object_md', 'num_parts'],
                properties: {
                    object_md: { $ref: '#/definitions/object_info' },
                    num_parts: { type: 'integer' },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        read_object_mapping: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'obj_id',
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    obj_id: { objectid: true },
                    start: { type: 'integer' },
                    end: { type: 'integer' },
                    location_info: { $ref: 'common_api#/definitions/location_info' },
                },
            },
            reply: {
                type: 'object',
                required: ['object_md', 'chunks'],
                properties: {
                    object_md: { $ref: '#/definitions/object_info' },
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' },
                    },
                }
            },
            auth: {
                system: ['admin', 'user'],
                anonymous: true,
            }
        },

        read_object_mapping_admin: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    version_id: { type: 'string' },
                    skip: { type: 'integer' },
                    limit: { type: 'integer' },
                },
            },
            reply: {
                type: 'object',
                required: ['object_md', 'chunks'],
                properties: {
                    object_md: { $ref: '#/definitions/object_info' },
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' },
                    },
                }
            },
            auth: { system: 'admin' }
        },

        read_node_mapping: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    skip: { type: 'integer' },
                    limit: { type: 'integer' },
                    by_host: { type: 'boolean' },
                    adminfo: { type: 'boolean' },
                }
            },
            reply: {
                type: 'object',
                required: ['chunks', 'objects'],
                properties: {
                    total_chunks: { type: 'number' },
                    chunks: {
                        type: 'array',
                        items: { $ref: '#/definitions/chunk_info' }
                    },
                    objects: {
                        type: 'array',
                        items: { $ref: '#/definitions/object_info' }
                    },
                }
            },
            auth: { system: 'admin' }
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
                    obj_id: { objectid: true },
                    version_id: { type: 'string' },
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    md_conditions: { $ref: '#/definitions/md_conditions' },
                    encryption: { $ref: 'common_api#/definitions/object_encryption' },
                    adminfo: {
                        type: 'object',
                        properties: {
                            signed_url_endpoint: { type: 'string' },
                        }
                    },
                }
            },
            reply: {
                $ref: '#/definitions/object_info'
            },
            auth: {
                system: ['admin', 'user'],
                anonymous: true,
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
                    obj_id: { objectid: true },
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    content_type: { type: 'string' },
                    content_encoding: { type: 'string' },
                    xattr: { $ref: '#/definitions/xattr' },
                    cache_last_valid_time: { idate: true },
                    last_modified_time: { idate: true },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        dispatch_triggers: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'obj',
                    'event_name'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    obj: {
                        $ref: '#/definitions/object_info'
                    },
                    event_name: { $ref: 'common_api#/definitions/bucket_trigger_event' }
                }
            },
            auth: { system: ['admin', 'user'] }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: { type: 'string' },
                    obj_id: { objectid: true },
                    version_id: { type: 'string' },
                    md_conditions: { $ref: '#/definitions/md_conditions' },
                    bypass_governance: { type: 'boolean' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    deleted_version_id: { type: 'string' },
                    deleted_delete_marker: { type: 'boolean' },
                    created_version_id: { type: 'string' },
                    created_delete_marker: { type: 'boolean' },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        delete_multiple_objects: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'bucket',
                    'objects',
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['key'],
                            properties: {
                                key: { type: 'string' },
                                version_id: { type: 'string' },
                            }
                        }
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        deleted_version_id: { type: 'string' },
                        deleted_delete_marker: { type: 'boolean' },
                        created_version_id: { type: 'string' },
                        created_delete_marker: { type: 'boolean' },
                        err_code: {
                            type: 'string',
                            enum: ['AccessDenied', 'InternalError']
                        },
                        err_message: { type: 'string' }
                    }
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        list_objects: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
                    }
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        list_object_versions: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    delimiter: {
                        type: 'string',
                    },
                    prefix: {
                        type: 'string',
                    },
                    key_marker: {
                        type: 'string',
                    },
                    version_id_marker: {
                        type: 'string',
                    },
                    limit: {
                        type: 'integer'
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
                    next_version_id_marker: {
                        type: 'string'
                    }
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        list_uploads: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
            auth: { system: ['admin', 'user'] }
        },

        list_objects_admin: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
                    latest_versions: {
                        type: 'boolean'
                    },
                    filter_delete_markers: {
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
                    },
                    empty_reason: {
                        type: 'string',
                        enum: ['NO_MATCHING_KEYS', 'NO_RESULTS', 'NO_UPLOADS', 'NO_LATEST', 'NO_OBJECTS']
                    }
                }
            },
            auth: { system: 'admin' }
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
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
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
            auth: { system: ['admin', 'user'] }
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
            auth: { system: ['admin', 'user'] }
        },

        add_endpoint_report: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'timestamp',
                    'group_name',
                    'hostname'
                ],
                properties: {
                    timestamp: {
                        idate: true
                    },
                    group_name: {
                        type: 'string'
                    },
                    hostname: {
                        type: 'string'
                    },
                    cpu: {
                        $ref: '#/definitions/endpoint_cpu_info'
                    },
                    memory: {
                        $ref: '#/definitions/endpoint_memory_info'
                    },
                    s3_ops: {
                        type: 'object',
                        properties: {
                            usage: {
                                $ref: '#/definitions/s3_usage_info'
                            },
                            errors: {
                                $ref: '#/definitions/s3_errors_info'
                            }
                        }
                    },
                    bandwidth: {
                        $ref: '#/definitions/bandwidth_usage_info'
                    }
                }
            },
            auth: {
                system: ['admin']
            }
        },

        update_endpoint_stats: {
            method: 'PUT',
            params: {
                type: 'object',
                properties: {
                    namespace_stats: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                namespace_resource_id: {
                                    objectid: true
                                },
                                io_stats: {
                                    $ref: 'common_api#/definitions/io_stats'
                                }
                            }
                        }
                    },
                    bucket_counters: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                                content_type: {
                                    type: 'string'
                                },
                                read_count: { type: 'integer' },
                                write_count: { type: 'integer' },
                            }
                        }
                    }
                }
            },
            auth: {
                system: ['admin']
            }
        },

        reset_s3_ops_counters: {
            method: 'DELETE',
            auth: {
                system: 'admin',
            }
        },

        read_s3_ops_counters: {
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

        delete_multiple_objects_by_filter: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    prefix: {
                        type: 'string',
                    },
                    create_time: {
                        idate: true,
                    },
                    filter_delete_markers: {
                        type: 'boolean',
                    },
                    size_less: {
                        type: 'integer'
                    },
                    size_greater: {
                        type: 'integer'
                    },
                    tags: {
                        $ref: 'common_api#/definitions/tagging'
                    },
                    limit: {
                        type: 'integer'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    is_empty: {
                        type: 'boolean'
                    }
                }
            },
            auth: { system: 'admin' }
        },

        delete_multiple_objects_unordered: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['bucket'],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    limit: {
                        type: 'integer'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    is_empty: {
                        type: 'boolean'
                    }
                }
            },
            auth: { system: 'admin' }
        },

        put_object_legal_hold: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket',
                    'legal_hold'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: { type: 'string' },
                    legal_hold: {
                        type: 'object',
                        properties: {
                            status: {
                                type: 'string',
                                enum: ['ON', 'OFF'],
                            },
                        },
                    }
                }
            },
            auth: { system: 'admin' }
        },
        get_object_legal_hold: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    legal_hold: {
                        type: 'object',
                        properties: {
                            status: {
                                type: 'string',
                                enum: ['ON', 'OFF'],
                            },
                        },
                    }
                }
            },
            auth: { system: 'admin' }
        },
        put_object_retention: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket',
                    'retention'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: { type: 'string' },
                    retention: {
                        type: 'object',
                        properties: {
                            mode: {
                                type: 'string',
                                enum: ['GOVERNANCE', 'COMPLIANCE'],
                            },
                            retain_until_date: { date: true },
                        },
                    },
                    bypass_governance: {
                        type: 'boolean',
                    },
                }
            },
            auth: { system: 'admin' }
        },
        get_object_retention: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    retention: {
                        type: 'object',
                        properties: {
                            mode: {
                                type: 'string',
                                enum: ['GOVERNANCE', 'COMPLIANCE'],
                            },
                            retain_until_date: { date: true },
                        },
                    }
                }
            },
            auth: { system: 'admin' }
        },
        put_object_tagging: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'tagging',
                    'key',
                    'bucket'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    tagging: {
                        $ref: 'common_api#/definitions/tagging'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    version_id: { type: 'string' },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        delete_object_tagging: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    version_id: { type: 'string' },
                }
            },
            auth: { system: ['admin', 'user'] }
        },

        get_object_tagging: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'key',
                    'bucket'
                ],
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    key: {
                        type: 'string',
                    },
                    version_id: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    tagging: {
                        $ref: 'common_api#/definitions/tagging'
                    },
                    version_id: { type: 'string' }
                }
            },
            auth: { system: ['admin', 'user'] }
        },

    },

    definitions: {

        object_info: {
            type: 'object',
            required: [
                'obj_id',
                'bucket',
                'key',
                'size',
                'content_type',
            ],
            properties: {
                obj_id: { objectid: true },
                bucket: { $ref: 'common_api#/definitions/bucket_name' },
                key: { type: 'string' },
                size: { type: 'integer' },
                version_id: { type: 'string' },
                is_latest: { type: 'boolean' },
                delete_marker: { type: 'boolean' },
                num_parts: { type: 'integer' },
                content_type: { type: 'string' },
                content_encoding: { type: 'string' },
                create_time: { idate: true },
                cache_last_valid_time: { idate: true },
                last_modified_time: { idate: true },
                upload_started: { idate: true },
                upload_size: { type: 'integer' },
                etag: { type: 'string' },
                md5_b64: { type: 'string' },
                sha256_b64: { type: 'string' },
                xattr: { $ref: '#/definitions/xattr' },
                stats: {
                    type: 'object',
                    properties: {
                        reads: { type: 'integer' },
                        last_read: { idate: true }
                    }
                },
                tagging: { $ref: 'common_api#/definitions/tagging' },
                encryption: { $ref: 'common_api#/definitions/object_encryption' },
                tag_count: { type: 'integer' },
                // This is the physical size (aggregation of all blocks)
                // It does not pay attention to dedup
                capacity_size: { type: 'integer' },
                s3_signed_url: { type: 'string' },
                lock_settings: { $ref: 'common_api#/definitions/lock_settings' },
            }
        },

        part_info: {
            type: 'object',
            required: [
                'start',
                'end',
                'seq',
            ],
            properties: {
                chunk_id: { objectid: true },
                obj_id: { objectid: true },
                multipart_id: { objectid: true },
                start: { type: 'integer' },
                end: { type: 'integer' },
                seq: { type: 'integer' },
                chunk_offset: { type: 'integer' },
                uncommitted: { type: 'boolean' },
            }
        },

        chunk_info: {
            type: 'object',
            required: [
                'size',
                'frags'
            ],
            properties: {
                _id: { objectid: true },
                bucket_id: { objectid: true },
                tier_id: { objectid: true },
                master_key_id: { objectid: true },
                dup_chunk: { objectid: true },
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
                    items: { $ref: '#/definitions/frag_info' }
                },
                parts: {
                    type: 'array',
                    items: { $ref: '#/definitions/part_info' }
                },
                is_accessible: { type: 'boolean' },
                is_building_blocks: { type: 'boolean' },
                is_building_frags: { type: 'boolean' },
            }
        },

        frag_info: {
            type: 'object',
            properties: {
                _id: { objectid: true },
                data_index: { type: 'integer' },
                parity_index: { type: 'integer' },
                lrc_index: { type: 'integer' },
                digest_b64: { type: 'string' },
                blocks: {
                    type: 'array',
                    items: { $ref: '#/definitions/block_info' }
                },
                allocations: {
                    type: 'array',
                    items: { $ref: '#/definitions/allocation_info' }
                },
                is_accessible: { type: 'boolean' },
            }
        },

        block_info: {
            type: 'object',
            required: ['block_md'],
            properties: {
                block_md: { $ref: 'common_api#/definitions/block_md' },
                is_accessible: { type: 'boolean' },
                is_deletion: { type: 'boolean' },
                is_future_deletion: { type: 'boolean' },
                adminfo: {
                    type: 'object',
                    required: ['mirror_group', 'pool_name', 'node_name', 'node_ip', 'online'],
                    properties: {
                        mirror_group: { type: 'string' },
                        pool_name: { type: 'string' },
                        node_name: { type: 'string' },
                        node_ip: { type: 'string' },
                        host_name: { type: 'string' },
                        mount: { type: 'string' },
                        online: { type: 'boolean' },
                        in_cloud_pool: { type: 'boolean' },
                        in_mongo_pool: { type: 'boolean' },
                    }
                }
            }
        },

        allocation_info: {
            type: 'object',
            required: ['mirror_group', 'block_md'],
            properties: {
                mirror_group: { type: 'string' },
                block_md: { $ref: 'common_api#/definitions/block_md' },
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
            additionalProperties: {
                type: 'integer'
            }
        },

        s3_errors_info: {
            type: 'object',
            additionalProperties: {
                type: 'integer'
            }
        },

        bandwidth_usage_info: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    read_bytes: { type: 'integer' },
                    write_bytes: { type: 'integer' },
                    read_count: { type: 'integer' },
                    write_count: { type: 'integer' },
                }
            }
        },

        endpoint_cpu_info: {
            type: 'object',
            properties: {
                count: { type: 'number' },
                usage: { type: 'number' }
            }
        },

        endpoint_memory_info: {
            type: 'object',
            properties: {
                total: { type: 'number' },
                used: { type: 'number' }
            }
        }
    },
};
