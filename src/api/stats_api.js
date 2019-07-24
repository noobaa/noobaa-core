/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * STATS API
 *
 *
 */
module.exports = {

    id: 'stats_api',

    methods: {

        get_systems_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/systems_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_partial_systems_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/partial_systems_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_partial_accounts_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/partial_accounts_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_partial_providers_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/partial_providers_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_nodes_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/nodes_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_pool_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/pools_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_bucket_sizes_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/bucket_sizes_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_cloud_pool_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/cloud_pool_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_tier_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/tier_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_object_usage_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/object_usage_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_ops_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/ops_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_all_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/all_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_partial_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/partial_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        object_usage_scrubber: {
            method: 'GET',
            auth: {
                system: 'admin'
            }
        },

        send_stats: {
            method: 'PUT',
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {

        systems_stats: {
            type: 'object',
            required: ['version', 'agent_version', 'count', 'version_history'],
            properties: {
                clusterid: {
                    type: 'string',
                },
                version: {
                    type: 'string',
                },
                os_release: {
                    type: 'string'
                },
                platform: {
                    type: 'string'
                },
                agent_version: {
                    type: 'string',
                },
                count: {
                    type: 'integer'
                },
                version_history: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                },
                systems: {
                    type: 'array',
                    items: {
                        type: 'object',
                        // required: [],
                        properties: {
                            tiers: {
                                type: 'integer'
                            },
                            buckets: {
                                type: 'integer'
                            },
                            buckets_config: {
                                type: 'array',
                                items: {
                                    $ref: '#/definitions/bucket_config'
                                }
                            },
                            chunks: {
                                type: 'integer'
                            },
                            // chunks_rebuilt_since_last: {
                            //     type: 'integer'
                            // },
                            objects: {
                                type: 'integer'
                            },
                            roles: {
                                type: 'integer'
                            },
                            owner: { $ref: 'common_api#/definitions/email' },
                            allocated_space: {
                                $ref: 'common_api#/definitions/bigint'
                            },
                            used_space: {
                                $ref: 'common_api#/definitions/bigint'
                            },
                            total_space: {
                                $ref: 'common_api#/definitions/bigint'
                            },
                            free_space: {
                                $ref: 'common_api#/definitions/bigint'
                            },
                            associated_nodes: {
                                type: 'object',
                                properties: {
                                    on: {
                                        type: 'integer'
                                    },
                                    off: {
                                        type: 'integer'
                                    }
                                }
                            },
                            cluster: {
                                type: 'object',
                                properties: {
                                    members: {
                                        type: 'integer'
                                    }
                                }
                            },
                            configuration: {
                                type: 'object',
                                properties: {
                                    dns_servers: {
                                        type: 'integer'
                                    },
                                    dns_name: {
                                        type: 'boolean'
                                    },
                                    dns_search: {
                                        type: 'integer'
                                    },
                                }
                            }
                        }
                    }
                }
            }
        },

        bucket_config: {
            type: 'object',
            properties: {
                num_objects: {
                    type: 'integer'
                },
                versioning: {
                    type: 'string'
                },
                quota: {
                    type: 'boolean'
                },
                tiers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            placement_type: {
                                type: 'string'
                            },
                            mirrors: {
                                type: 'integer'
                            },
                            // spillover_enabled: {
                            //     type: 'boolean'
                            // },
                            replicas: {
                                type: 'integer'
                            },
                            data_frags: {
                                type: 'integer'
                            },
                            parity_frags: {
                                type: 'integer'
                            }
                        }
                    }
                }
            }
        },

        nodes_stats: {
            type: 'object',
            required: ['count', 'hosts_count', 'os', 'nodes_with_issue'],
            properties: {
                nodes_with_issue: {
                    type: 'integer'
                },
                count: {
                    type: 'integer'
                },
                hosts_count: {
                    type: 'integer'
                },
                os: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                histograms: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },

        cloud_pool_stats: {
            type: 'object',
            required: ['pool_count', 'unhealthy_pool_count', 'cloud_pool_count', 'cloud_pool_target', 'unhealthy_cloud_pool_target', 'resources'],
            properties: {
                pool_count: {
                    type: 'integer'
                },
                unhealthy_pool_count: {
                    type: 'integer'
                },
                cloud_pool_count: {
                    type: 'integer'
                },
                cloud_pool_target: {
                    type: 'object',
                    properties: {
                        amazon: { type: 'integer' },
                        azure: { type: 'integer' },
                        gcp: { type: 'integer' },
                        s3_comp: { type: 'integer' },
                        other: { type: 'integer' },
                    }
                },
                unhealthy_cloud_pool_target: {
                    type: 'object',
                    properties: {
                        amazon_unhealthy: { type: 'integer' },
                        azure_unhealthy: { type: 'integer' },
                        gcp_unhealthy: { type: 'integer' },
                        s3_comp_unhealthy: { type: 'integer' },
                        other_unhealthy: { type: 'integer' },
                    }
                },

                compatible_auth_type: {
                    type: 'object',
                    properties: {
                        v2: {
                            type: 'integer'
                        },
                        v4: {
                            type: 'integer'
                        },
                    }
                },
                resources: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['resource_name', 'is_healthy'],
                        properties: {
                            resource_name: {
                                type: 'string'
                            },
                            is_healthy: {
                                type: 'boolean'
                            }
                        }
                    }
                }
            }
        },

        bucket_sizes_stats: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            }
        },

        ops_stats: {
            type: 'object',
            properties: {
                deletes: {
                    type: 'integer'
                },
                writes: {
                    type: 'integer'
                },
                reads: {
                    type: 'integer'
                },
                list_objects: {
                    type: 'integer'
                },
            }
        },

        pools_stats: {
            type: 'array',
            items: {
                type: 'integer',
            },
        },

        tier_stats: {
            type: 'array',
            items: {
                type: 'object',
                // required: [],
                properties: {
                    pools_num: {
                        type: 'integer',
                    },
                    data_placement: {
                        type: 'string',
                    }
                },
            }
        },

        object_usage_stats: {
            type: 'array',
            items: {
                type: 'object',
                // required: [],
                properties: {
                    system: {
                        type: 'string',
                    },
                    time: {
                        idate: true,
                    },
                    s3_usage_info: {
                        $ref: 'object_api#/definitions/s3_usage_info',
                    },
                    s3_errors_info: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                },
            }
        },

        all_stats: {
            type: 'object',
            required: ['systems_stats', 'nodes_stats',
                'ops_stats', 'pools_stats', 'tier_stats', 'cloud_pool_stats',
                'bucket_sizes_stats', 'object_usage_stats'
            ],
            properties: {
                systems_stats: {
                    $ref: '#/definitions/systems_stats'
                },
                nodes_stats: {
                    $ref: '#/definitions/nodes_stats'
                },
                ops_stats: {
                    $ref: '#/definitions/ops_stats'
                },
                pools_stats: {
                    $ref: '#/definitions/pools_stats'
                },
                tier_stats: {
                    $ref: '#/definitions/tier_stats'
                },
                cloud_pool_stats: {
                    $ref: '#/definitions/cloud_pool_stats'
                },
                bucket_sizes_stats: {
                    $ref: '#/definitions/bucket_sizes_stats'
                },
                object_usage_stats: {
                    $ref: '#/definitions/object_usage_stats'
                },
            }
        },

        partial_stats: {
            type: 'object',
            required: ['systems_stats', 'cloud_pool_stats', 'accounts_stats'],
            properties: {
                systems_stats: {
                    $ref: '#/definitions/partial_systems_stats'
                },
                cloud_pool_stats: {
                    $ref: '#/definitions/cloud_pool_stats'
                },
                accounts_stats: {
                    $ref: '#/definitions/partial_accounts_stats'
                },
                providers_stats: {
                    $ref: '#/definitions/partial_providers_stats'
                },
            }
        },

        partial_systems_stats: {
            type: 'object',
            required: ['systems'],
            properties: {
                systems: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: [
                            'name',
                            'address',
                            'capacity',
                            'reduction_ratio',
                            'savings',
                            'total_usage',
                            'buckets_stats',
                            'usage_by_project',
                            'usage_by_bucket_class',
                        ],
                        properties: {
                            name: {
                                type: 'string'
                            },
                            address: {
                                type: 'string'
                            },
                            capacity: {
                                type: 'number'
                            },
                            total_usage: {
                                type: 'number'
                            },
                            savings: {
                                type: 'object',
                                required: ['logical_size', 'physical_size'],
                                properties: {
                                    logical_size: {
                                        type: 'number'
                                    },
                                    physical_size: {
                                        type: 'number'
                                    }
                                }
                            },
                            reduction_ratio: {
                                type: 'number'
                            },
                            buckets_stats: {
                                $ref: '#/definitions/partial_buckets_stats'
                            },
                            // TODO: Fix the regex for the projects name
                            usage_by_project: {
                                type: 'object',
                                patternProperties: {
                                    '^[a-zA-Z0-9_]+$': {
                                        type: 'number',
                                    }
                                },
                            },
                            // TODO: Fix the regex for the bucket classes
                            usage_by_bucket_class: {
                                type: 'object',
                                patternProperties: {
                                    '^[a-zA-Z0-9_]+$': {
                                        type: 'number',
                                    }
                                },
                            },
                        }
                    }
                }
            }
        },

        partial_providers_stats: {
            type: 'object',
            patternProperties: {
                '^[a-zA-Z0-9_]+$': {
                    type: 'object',
                    required: ['logical_size', 'physical_size'],
                    properties: {
                        logical_size: {
                            type: 'number'
                        },
                        physical_size: {
                            type: 'number'
                        },
                    }
                }
            },
        },

        partial_accounts_stats: {
            type: 'object',
            required: ['accounts', 'accounts_num'],
            properties: {
                accounts: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['account', 'read_count', 'write_count', 'read_write_bytes'],
                        properties: {
                            account: {
                                type: 'string'
                            },
                            read_count: {
                                type: 'number'
                            },
                            write_count: {
                                type: 'number'
                            },
                            read_write_bytes: {
                                type: 'number'
                            },
                        }
                    }
                },
                accounts_num: {
                    type: 'number',
                },
            }
        },


        partial_buckets_stats: {
            type: 'object',
            required: ['buckets', 'buckets_num', 'objects_in_buckets', 'unhealthy_buckets', 'bucket_claims', 'objects_in_bucket_claims', 'unhealthy_bucket_claims'],
            properties: {
                buckets: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['bucket_name', 'quota_precent', 'capacity_precent', 'is_healthy'],
                        properties: {
                            bucket_name: {
                                type: 'string'
                            },
                            quota_precent: {
                                type: 'number'
                            },
                            capacity_precent: {
                                type: 'number'
                            },
                            is_healthy: {
                                type: 'boolean'
                            },
                        }
                    }
                },
                buckets_num: { type: 'integer' },
                objects_in_buckets: { type: 'integer' },
                unhealthy_buckets: { type: 'integer' },
                bucket_claims: { type: 'integer' },
                objects_in_bucket_claims: { type: 'integer' },
                unhealthy_bucket_claims: { type: 'integer' },
            }
        },
    },

};
