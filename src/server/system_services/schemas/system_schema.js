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
            format: 'idate'
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
        // we use free mongoose schema, because it's field types are non trivial
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
            // type: 'object',
            // additionalProperties: true,
            // properties: {}
            format: 'idate'
        },
        // the DNS name or IP address used for the server
        base_address: {
            type: 'string'
        },
        phone_home_proxy_address: {
            type: 'string'
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

        //NTP configuration
        ntp: {
            type: 'object',
            properties: {
                server: {
                    type: 'string'
                },
                timezone: {
                    type: 'string'
                },
            }
        },

        //Debug Level:
        debug_level: {
            type: 'integer'
        },
    }
};
