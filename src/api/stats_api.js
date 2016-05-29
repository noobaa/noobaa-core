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

        get_cloud_sync_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/cloud_sync_stats'
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
    },

    definitions: {

        systems_stats: {
            type: 'object',
            required: ['version', 'agent_version', 'count'],
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
                            chunks: {
                                type: 'integer'
                            },
                            objects: {
                                type: 'integer'
                            },
                            roles: {
                                type: 'integer'
                            },
                            allocated_space: {
                                type: 'integer'
                            },
                            used_space: {
                                type: 'integer'
                            },
                            total_space: {
                                type: 'integer'
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
                            }
                        }
                    }
                }
            }
        },

        nodes_stats: {
            type: 'object',
            required: ['count', 'os'],
            properties: {
                count: {
                    type: 'integer'
                },
                os: {
                    type: 'object',
                    properties: {
                        win: {
                            type: 'integer'
                        },
                        osx: {
                            type: 'integer'
                        },
                        linux: {
                            type: 'integer'
                        },
                        other: {
                            type: 'integer'
                        }
                    }
                },
                histograms: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },

        cloud_sync_stats: {
            type: 'object',
            required: ['bucket_count', 'sync_count', 'sync_type', 'sync_target'],
            properties: {
                bucket_count: {
                    type: 'integer'
                },
                sync_count: {
                    type: 'integer'
                },
                sync_type: {
                    type: 'object',
                    properties: {
                        c2n: {
                            type: 'integer'
                        },
                        n2c: {
                            type: 'integer'
                        },
                        bi_directional: {
                            type: 'integer'
                        },
                        additions_and_deletions: {
                            type: 'integer'
                        },
                        additions_only: {
                            type: 'integer'
                        }
                    }
                },
                sync_target: {
                    type: 'object',
                    properties: {
                        amazon: {
                            type: 'integer'
                        },
                        other: {
                            type: 'integer'
                        }
                    }
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
                        other: {
                            type: 'integer'
                        }
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
                        format: 'idate',
                    },
                    s3_usage_info: {
                        $ref: 'object_api#/definitions/s3_usage_info',
                    }
                },
            }
        },

        all_stats: {
            type: 'object',
            required: ['systems_stats', 'cloud_sync_stats', 'nodes_stats',
                'ops_stats', 'pools_stats', 'tier_stats', 'cloud_pool_stats',
                'bucket_sizes_stats', 'object_usage_stats'],
            properties: {
                systems_stats: {
                    $ref: '#/definitions/systems_stats'
                },
                cloud_sync_stats: {
                    $ref: '#/definitions/cloud_sync_stats'
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
