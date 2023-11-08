/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'system_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'owner',
    ],
    properties: {

        _id: { objectid: true },
        master_key_id: { objectid: true },
        deleted: { date: true },
        name: { type: 'string' },
        owner: { objectid: true }, // account id
        state: {
            type: 'object',
            required: [
                'mode',
                'last_update'
            ],
            properties: {
                mode: {
                    type: 'string',
                    enum: [
                        'INITIALIZING',
                        'COULD_NOT_INITIALIZE',
                        'READY',
                    ],
                },
                last_update: {
                    idate: true
                }
            }
        },
        default_chunk_config: { objectid: true },

        // links to system resources used for storing install packages
        resources: {
            type: 'object',
            // required: [],
            properties: {
                agent_installer: {
                    type: 'string'
                },
                linux_agent_installer: {
                    type: 'string'
                },
                s3rest_installer: {
                    type: 'string'
                },
            }
        },
        // n2n_config
        // keeps the n2n configuration for agents and other endpoints (see rpc_n2n.js)
        // we use free schema, because it's field types are non trivial
        // (see n2n_config json schema in common_api.js) and there's no benefit
        // redefining it.
        n2n_config: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        },
        last_stats_report: {
            idate: true
        },
        maintenance_mode: {
            idate: true
        },
        system_address: {
            type: 'array',
            items: {
                type: 'object',
                required: ['service', 'kind', 'hostname', 'port', 'api', 'secure', 'weight'],
                properties: {
                    service: {
                        type: 'string',
                        enum: ['noobaa-mgmt', 's3', 'sts', 'noobaa-db', 'noobaa-db-pg', 'noobaa-syslog']
                    },
                    kind: {
                        type: 'string',
                        enum: ['INTERNAL', 'EXTERNAL']
                    },
                    hostname: { type: 'string' },
                    port: { $ref: 'common_api#/definitions/port' },
                    api: {
                        type: 'string',
                        enum: ['mgmt', 's3', 'sts', 'md', 'bg', 'hosted_agents', 'mongodb', 'metrics', 'postgres', 'syslog']
                    },
                    secure: { type: 'boolean' },
                    weight: { type: 'integer' }
                }
            }
        },
        virtual_hosts: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        freemium_cap: {
            type: 'object',
            properties: {
                phone_home_upgraded: {
                    type: 'boolean'
                },
                phone_home_notified: {
                    type: 'boolean'
                },
                phone_home_unable_comm: {
                    type: 'boolean'
                },
                cap_terabytes: {
                    type: 'number'
                }
            },
        },

        bg_workers_info: {
            type: 'object',
            properties: {
                mirror_writer_info: {
                    type: 'object',
                    properties: {
                        start_marker: {
                            objectid: true
                        },
                        retry_range: {
                            type: 'object',
                            properties: {
                                start: {
                                    objectid: true
                                },
                                end: {
                                    objectid: true
                                },
                            }
                        }
                    },
                }
            }
        },

        // //NTP configuration
        // ntp: {
        //     type: 'object',
        //     properties: {
        //         server: {
        //             type: 'string'
        //         },
        //         timezone: {
        //             type: 'string'
        //         },
        //     }
        // },

        //Debug Level:
        debug_level: {
            type: 'integer'
        },

        debug_mode: {
            idate: true
        },

        mongo_upgrade: {
            type: 'object',
            // required: [],
            properties: {
                blocks_to_buckets: {
                    type: 'boolean'
                }
            }
        },


        current_version: {
            type: 'string'
        },

        //history of past upgrades
        upgrade_history: {
            type: 'object',
            properties: {
                successful_upgrades: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            timestamp: {
                                idate: true
                            },
                            from_version: {
                                type: 'string'
                            },
                            to_version: {
                                type: 'string'
                            },
                            // upgrade scripts that were run during the upgrade process
                            completed_scripts: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            }
                        }
                    }

                },
                last_failure: {
                    type: 'object',
                    properties: {
                        timestamp: {
                            idate: true
                        },
                        from_version: {
                            type: 'string'
                        },
                        to_version: {
                            type: 'string'
                        },
                        // upgrade scripts that were run during the upgrade process
                        completed_scripts: {
                            type: 'array',
                            items: {
                                type: 'string'
                            }
                        },
                        error: {
                            type: 'string'
                        }
                    }
                }
            }
        },

        global_last_update: {
            idate: true
        },
    }
};
