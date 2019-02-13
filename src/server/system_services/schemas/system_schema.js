/* Copyright (C) 2016 NooBaa */
'use strict';

const { SensitiveString } = require('../../../util/schema_utils');

module.exports = {
    id: 'system_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'owner',
    ],
    properties: {

        _id: { objectid: true },
        deleted: { date: true },
        name: { type: 'string' },
        owner: { objectid: true }, // account id
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
        // the DNS name or IP address used for the server
        base_address: {
            type: 'string'
        },
        phone_home_proxy_address: {
            type: 'string'
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

        //Remote syslog configuration
        remote_syslog_config: {
            type: 'object',
            properties: {
                protocol: {
                    type: 'string'
                },
                address: {
                    type: 'string'
                },
                port: {
                    type: 'number'
                }
            }
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

        //Last upgrade information
        last_upgrade: {
            type: 'object',
            properties: {
                timestamp: {
                    idate: true
                },
                initiator: {
                    wrapper: SensitiveString
                }
            }
        }
    }
};
