'use strict';

module.exports = {
    id: 'system_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'owner',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date'
        },
        name: {
            type: 'string'
        },
        owner: {
            format: 'objectid' // account id
        },
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
            format: 'idate'
        },
        maintenance_mode: {
            format: 'idate'
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

        //Last upgrade date
        upgrade_date: {
            format: 'idate'
        }

    }
};
