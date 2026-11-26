/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 *
 * TABLE API
 *
 * The internal persistence API for the S3 Tables catalog (design §3.4, §6.3). Served by
 * table_server, backed by the dedicated table_store collections. It is mapped to the `md`
 * domain in api_routes, so it is an in-process fcall in an endpoint running its own
 * metadata server (LOCAL_MD_SERVER=true) and an RPC to core otherwise.
 *
 * Covers table-bucket, namespace and table CRUD, the table-bucket state transitions and
 * the pointer swap - the full surface, so story 4 adds no API of its own and story 6b
 * implements the transactional and conditional operations behind these same methods.
 *
 * This is NOT the s3tables wire protocol - it is the layer below the facades and the SDK.
 */
module.exports = {

    $id: 'table_api',

    methods: {

        //////////////////////
        //   TABLE BUCKETS  //
        //////////////////////

        create_table_bucket: {
            doc: 'Insert a table-bucket record (record-first lifecycle, §6.4 rule 2)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'backing_bucket_name', 'state'],
                properties: {
                    name: { type: 'string' },
                    owner: { objectid: true },
                    backing_bucket_name: { type: 'string' },
                    backing_bucket: { objectid: true },
                    state: { $ref: '#/definitions/table_bucket_state' },
                    encryption: { $ref: '#/definitions/table_encryption' },
                }
            },
            reply: {
                $ref: '#/definitions/table_bucket_info'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        get_table_bucket: {
            doc: 'Read a table-bucket record by name or by id',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    table_bucket_id: { objectid: true },
                    include_inactive: { type: 'boolean' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    table_bucket: { $ref: '#/definitions/table_bucket_info' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        list_table_buckets: {
            doc: 'List table-bucket records, paginated',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    owner: { objectid: true },
                    state: { $ref: '#/definitions/table_bucket_state' },
                    limit: { type: 'integer' },
                    marker: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                required: ['table_buckets'],
                properties: {
                    table_buckets: {
                        type: 'array',
                        items: { $ref: '#/definitions/table_bucket_info' },
                    },
                    next_marker: { type: 'string' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        update_table_bucket: {
            doc: 'Update table-bucket fields; state transitions require the fixed expected predecessor (§6.1.3)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id'],
                properties: {
                    table_bucket_id: { objectid: true },
                    expected_state: { $ref: '#/definitions/table_bucket_state' },
                    state: { $ref: '#/definitions/table_bucket_state' },
                    backing_bucket: { objectid: true },
                    encryption: { $ref: '#/definitions/table_encryption' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        delete_table_bucket: {
            doc: 'Soft-delete a table-bucket record; optionally conditional on its state',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id'],
                properties: {
                    table_bucket_id: { objectid: true },
                    expected_state: { $ref: '#/definitions/table_bucket_state' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        //////////////////////
        //    NAMESPACES    //
        //////////////////////

        create_table_namespace: {
            doc: 'Insert a namespace record under a table bucket',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'name'],
                properties: {
                    table_bucket_id: { objectid: true },
                    name: { type: 'string' },
                    properties: { $ref: '#/definitions/namespace_properties' },
                }
            },
            reply: {
                $ref: '#/definitions/table_namespace_info'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        get_table_namespace: {
            doc: 'Read a namespace record by name',
            method: 'GET',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'name'],
                properties: {
                    table_bucket_id: { objectid: true },
                    name: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    namespace: { $ref: '#/definitions/table_namespace_info' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        list_table_namespaces: {
            doc: 'List namespace records under a table bucket, paginated',
            method: 'GET',
            params: {
                type: 'object',
                required: ['table_bucket_id'],
                properties: {
                    table_bucket_id: { objectid: true },
                    limit: { type: 'integer' },
                    marker: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                required: ['namespaces'],
                properties: {
                    namespaces: {
                        type: 'array',
                        items: { $ref: '#/definitions/table_namespace_info' },
                    },
                    next_marker: { type: 'string' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        update_table_namespace: {
            doc: 'Update a namespace\'s properties',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'name', 'properties'],
                properties: {
                    table_bucket_id: { objectid: true },
                    name: { type: 'string' },
                    properties: { $ref: '#/definitions/namespace_properties' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        delete_table_namespace: {
            doc: 'Soft-delete a namespace record',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'name'],
                properties: {
                    table_bucket_id: { objectid: true },
                    name: { type: 'string' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        //////////////////////
        //      TABLES      //
        //////////////////////

        create_table: {
            doc: 'Insert a table pointer (initialized or uninitialized, §6.1.3)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'namespace_name', 'name'],
                properties: {
                    table_bucket_id: { objectid: true },
                    namespace_name: { type: 'string' },
                    name: { type: 'string' },
                    metadata_location: { type: 'string' },
                    metadata_etag: { type: 'string' },
                    version_token: { type: 'string' },
                    table_uuid: { type: 'string' },
                    kind: { $ref: '#/definitions/table_kind' },
                }
            },
            reply: {
                $ref: '#/definitions/table_info'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        get_table: {
            doc: 'Read a table pointer by {namespace_name, name} or by id',
            method: 'GET',
            params: {
                type: 'object',
                required: ['table_bucket_id'],
                properties: {
                    table_bucket_id: { objectid: true },
                    namespace_name: { type: 'string' },
                    name: { type: 'string' },
                    table_id: { objectid: true },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    table: { $ref: '#/definitions/table_info' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        list_tables: {
            doc: 'List table pointers in a namespace, paginated',
            method: 'GET',
            params: {
                type: 'object',
                required: ['table_bucket_id', 'namespace_name'],
                properties: {
                    table_bucket_id: { objectid: true },
                    namespace_name: { type: 'string' },
                    limit: { type: 'integer' },
                    marker: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                required: ['tables'],
                properties: {
                    tables: {
                        type: 'array',
                        items: { $ref: '#/definitions/table_info' },
                    },
                    next_marker: { type: 'string' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        rename_table: {
            doc: 'Move a pointer to a new namespace and/or name, conditional on it still ' +
                'carrying the resolved namespace_name and name (§6.1.2)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_id', 'namespace_name', 'name'],
                properties: {
                    table_id: { objectid: true },
                    namespace_name: { type: 'string' },
                    name: { type: 'string' },
                    new_namespace_name: { type: 'string' },
                    new_name: { type: 'string' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        delete_table: {
            doc: 'Soft-delete a pointer, conditional on {namespace_name, name} and ' +
                'optionally a version token (§6.1.2, §6.1.5)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_id', 'namespace_name', 'name'],
                properties: {
                    table_id: { objectid: true },
                    namespace_name: { type: 'string' },
                    name: { type: 'string' },
                    expected_version_token: { type: 'string' },
                }
            },
            reply: {
                $ref: '#/definitions/matched_reply'
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        update_table_metadata_location: {
            doc: 'The atomic pointer swap on table id and expected version token (§3.4, §6.3). ' +
                'Returns swapped / not_swapped / no_such_table.',
            method: 'POST',
            params: {
                type: 'object',
                required: ['table_id', 'expected_version_token', 'metadata_location', 'metadata_etag'],
                properties: {
                    table_id: { objectid: true },
                    expected_version_token: { type: 'string' },
                    metadata_location: { type: 'string' },
                    metadata_etag: { type: 'string' },
                    table_uuid: { type: 'string' },
                }
            },
            reply: {
                type: 'object',
                required: ['outcome'],
                properties: {
                    outcome: { $ref: '#/definitions/swap_outcome' },
                    version_token: { type: 'string' },
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

    },

    definitions: {

        table_bucket_state: {
            type: 'string',
            enum: ['provisioning', 'ready', 'aborting', 'deleting'],
        },

        table_kind: {
            type: 'string',
            enum: ['table', 'view'],
        },

        swap_outcome: {
            type: 'string',
            enum: ['swapped', 'not_swapped', 'no_such_table'],
        },

        matched_reply: {
            type: 'object',
            required: ['matched'],
            properties: {
                // true when exactly one row matched the conditional update
                matched: { type: 'boolean' },
            }
        },

        table_encryption: {
            type: 'object',
            required: ['sse_algorithm'],
            properties: {
                // the catalog only ever stores AES256; aws:kms/SSE-C are rejected by the SDK
                sse_algorithm: { type: 'string', enum: ['AES256'] },
            }
        },

        namespace_properties: {
            type: 'object',
            additionalProperties: { type: 'string' },
        },

        table_bucket_info: {
            type: 'object',
            required: ['_id', 'system', 'name', 'owner', 'backing_bucket_name', 'state'],
            properties: {
                _id: { objectid: true },
                system: { objectid: true },
                name: { type: 'string' },
                owner: { objectid: true },
                backing_bucket_name: { type: 'string' },
                backing_bucket: { objectid: true },
                state: { $ref: '#/definitions/table_bucket_state' },
                encryption: { $ref: '#/definitions/table_encryption' },
                created_at: { idate: true },
                deleted: { date: true },
            }
        },

        table_namespace_info: {
            type: 'object',
            required: ['_id', 'table_bucket', 'name'],
            properties: {
                _id: { objectid: true },
                table_bucket: { objectid: true },
                name: { type: 'string' },
                properties: { $ref: '#/definitions/namespace_properties' },
                created_at: { idate: true },
                deleted: { date: true },
            }
        },

        table_info: {
            type: 'object',
            required: ['_id', 'table_bucket', 'namespace_name', 'name', 'version_token', 'kind'],
            properties: {
                _id: { objectid: true },
                table_bucket: { objectid: true },
                namespace_name: { type: 'string' },
                name: { type: 'string' },
                metadata_location: { type: 'string' },
                metadata_etag: { type: 'string' },
                version_token: { type: 'string' },
                table_uuid: { type: 'string' },
                kind: { $ref: '#/definitions/table_kind' },
                created_at: { idate: true },
                deleted: { date: true },
            }
        },

    }
};
