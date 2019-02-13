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
                                    ntp_server: {
                                        type: 'boolean'
                                    },
                                    proxy: {
                                        type: 'boolean'
                                    },
                                    remote_syslog: {
                                        type: 'boolean'
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
                            spillover_enabled: {
                                type: 'boolean'
                            },
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
            required: ['pool_count', 'cloud_pool_count', 'cloud_pool_target'],
            properties: {
                pool_count: {
                    type: 'integer'
                },
                cloud_pool_count: {
                    type: 'integer'
                },
                cloud_pool_target: {
                    type: 'object',
                    properties: {
                        amazon: {
                            type: 'integer'
                        },
                        azure: {
                            type: 'integer'
                        },
                        gcp: {
                            type: 'integer'
                        },
                        other: {
                            type: 'integer'
                        }
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
    },

};
