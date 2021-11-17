/* Copyright (C) 2016 NooBaa */
/**
 *
 * HOST API
 *
 */
'use strict';


module.exports = {

    $id: 'host_api',

    methods: {


        read_host: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                },
            },
            reply: {
                $ref: '#/definitions/host_info'
            },
            auth: {
                system: 'admin'
            }
        },

        list_hosts: {
            method: 'GET',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    query: {
                        $ref: '#/definitions/hosts_query'
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                    sort: {
                        type: 'string',
                        enum: [
                            'name',
                            'ip',
                            'online',
                            'used',
                            'trusted',
                            'accessibility',
                            'connectivity',
                            'data_activity',
                            'mode',
                            'pool',
                            'services',
                            'recommended',
                            'healthy_drives'
                        ]
                    },
                    order: {
                        type: 'integer',
                    },
                    recommended_hint: {
                        type: 'string'
                    },
                    adminfo: {
                        type: 'boolean'
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['hosts'],
                properties: {
                    counters: {
                        type: 'object',
                        properties: {
                            non_paginated: {
                                type: 'integer'
                            },
                            by_mode: {
                                $ref: '#/definitions/mode_counters'
                            }
                        }
                    },
                    hosts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/host_info'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_host_services: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    services: {
                        type: 'object',
                        properties: {
                            storage: {
                                type: 'boolean'
                            }
                        }
                    },
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['name', 'enabled'],
                            properties: {
                                name: {
                                    type: 'string',
                                },
                                enabled: {
                                    type: 'boolean'
                                }
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_test_hosts: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['count', 'source'],
                properties: {
                    count: {
                        type: 'integer',
                    },
                    source: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name', 'rpc_address'],
                    properties: {
                        name: {
                            type: 'string'
                        },
                        rpc_address: {
                            type: 'string'
                        }
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        retrust_host: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        delete_host: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        hide_host: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        set_debug_host: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'level'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    level: {
                        type: 'integer',
                    }
                },
            },
            auth: {
                system: 'admin',
            }
        },

        diagnose_host: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'string'
            },
            auth: {
                system: 'admin',
            }
        }

    },


    definitions: {

        host_info: {
            type: 'object',
            required: ['name', 'storage_nodes_info'],
            properties: {
                name: {
                    type: 'string'
                },
                host_id: {
                    type: 'string'
                },
                pool: {
                    type: 'string'
                },
                geolocation: {
                    type: 'string'
                },
                ip: {
                    type: 'string'
                },
                base_address: {
                    type: 'string'
                },
                public_ip: {
                    type: 'string'
                },
                version: {
                    type: 'string'
                },
                version_install_time: {
                    idate: true
                },
                last_communication: {
                    idate: true
                },
                trusted: {
                    type: 'boolean',
                },
                hideable: {
                    type: 'boolean',
                },
                connectivity: {
                    $ref: 'node_api#/definitions/connectivity_type'
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                os_info: {
                    $ref: 'common_api#/definitions/os_info'
                },
                process_cpu_usage: {
                    type: 'number'
                },
                process_mem_usage: {
                    type: 'integer'
                },
                latency_to_server: {
                    $ref: 'node_api#/definitions/latency_array'
                },
                debug: {
                    type: 'object',
                    required: ['level'],
                    properties: {
                        level: {
                            type: 'integer',
                        },
                        time_left: { // in ms
                            type: 'integer'
                        },
                    },
                },
                rpc_address: {
                    type: 'string'
                },
                ports: {
                    type: 'object',
                    properties: {
                        range: {
                            $ref: 'common_api#/definitions/port_range_config'
                        }
                    }
                },
                suggested_pool: {
                    type: 'string'
                },
                mode: {
                    $ref: '#/definitions/host_mode'
                },
                storage_nodes_info: {
                    type: 'object',
                    properties: {
                        mode: {
                            $ref: '#/definitions/storage_nodes_mode'
                        },
                        enabled: {
                            type: 'boolean'
                        },
                        nodes: {
                            type: 'array',
                            items: {
                                $ref: 'node_api#/definitions/node_info'
                            }
                        },
                        data_activities: {
                            $ref: 'node_api#/definitions/data_activities'
                        }
                    }
                },
                untrusted_reasons: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            drive: {
                                $ref: 'common_api#/definitions/drive_info'
                            },
                            events: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        event: {
                                            type: 'string',
                                            enum: [
                                                'DATA_EVENT',
                                                'PERMISSION_EVENT'
                                            ]
                                        },
                                        time: {
                                            idate: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        storage_nodes_mode: {
            type: 'string',
            enum: [
                'OFFLINE',
                'DELETING',
                'DECOMMISSIONED',
                'DECOMMISSIONING',
                'UNTRUSTED',
                'STORAGE_NOT_EXIST',
                'IO_ERRORS',
                'N2N_ERRORS',
                'GATEWAY_ERRORS',
                'MIGRATING',
                'IN_PROCESS',
                'NO_CAPACITY',
                'LOW_CAPACITY',
                'N2N_PORTS_BLOCKED',
                'INITIALIZING',
                'OPTIMAL',
                'SOME_STORAGE_OFFLINE',
                'SOME_STORAGE_IO_ERRORS',
                'SOME_STORAGE_NOT_EXIST',
                'SOME_STORAGE_DECOMMISSIONING',
                'SOME_STORAGE_INITIALIZING',
                'SOME_STORAGE_MIGRATING',
            ]
        },

        host_mode: {
            type: 'string',
            enum: [
                'OFFLINE',
                'DELETING',
                'STORAGE_OFFLINE',
                'DECOMMISSIONED',
                'DECOMMISSIONING',
                'IO_ERRORS',
                'UNTRUSTED',
                'STORAGE_NOT_EXIST',
                'MIGRATING',
                'IN_PROCESS',
                'NO_CAPACITY',
                'LOW_CAPACITY',
                'GATEWAY_ERRORS',
                'N2N_ERRORS',
                'N2N_PORTS_BLOCKED',
                'INITIALIZING',
                'OPTIMAL',
                'SOME_STORAGE_OFFLINE',
                'SOME_STORAGE_IO_ERRORS',
                'SOME_STORAGE_NOT_EXIST',
                'SOME_STORAGE_DECOMMISSIONING',
                'SOME_STORAGE_INITIALIZING',
                'SOME_STORAGE_MIGRATING',
                'HAS_ERRORS',
                'HAS_ISSUES'
            ]
        },


        host_service_update: {
            type: 'object',
            properties: {
                enabled: {
                    type: 'boolean'
                },
                nodes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'enabled'],
                        properties: {
                            name: {
                                type: 'string',
                            },
                            enabled: {
                                type: 'string'
                            }
                        }
                    }
                }
            }
        },

        hosts_query: {
            type: 'object',
            properties: {
                hosts: {
                    type: 'array',
                    items: {
                        type: 'string',
                    }
                },
                pools: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
                filter: {
                    // regexp on name & ip
                    type: 'string'
                },
                mode: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/host_mode'
                    }
                },
                include_all: { // also include non BLOCK_STORE_FS nodes
                    type: 'boolean'
                }
            },
        },

        mode_counters: {
            type: 'object',
            properties: {
                OFFLINE: {
                    type: 'integer'
                },
                DELETING: {
                    type: 'integer'
                },
                STORAGE_OFFLINE: {
                    type: 'integer'
                },
                DECOMMISSIONED: {
                    type: 'integer'
                },
                DECOMMISSIONING: {
                    type: 'integer'
                },
                UNTRUSTED: {
                    type: 'integer'
                },
                STORAGE_NOT_EXIST: {
                    type: 'integer'
                },
                IO_ERRORS: {
                    type: 'integer'
                },
                N2N_ERRORS: {
                    type: 'integer'
                },
                GATEWAY_ERRORS: {
                    type: 'integer'
                },
                MIGRATING: {
                    type: 'integer'
                },
                IN_PROCESS: {
                    type: 'integer'
                },
                NO_CAPACITY: {
                    type: 'integer'
                },
                LOW_CAPACITY: {
                    type: 'integer'
                },
                N2N_PORTS_BLOCKED: {
                    type: 'integer'
                },
                INITIALIZING: {
                    type: 'integer'
                },
                OPTIMAL: {
                    type: 'integer'
                },
                SOME_STORAGE_OFFLINE: {
                    type: 'integer'
                },
                SOME_STORAGE_IO_ERRORS: {
                    type: 'integer'
                },
                SOME_STORAGE_NOT_EXIST: {
                    type: 'integer'
                },
                SOME_STORAGE_DECOMMISSIONING: {
                    type: 'integer'
                },
                SOME_STORAGE_INITIALIZING: {
                    type: 'integer'
                },
                SOME_STORAGE_MIGRATING: {
                    type: 'integer'
                },
                HAS_ERRORS: {
                    type: 'integer'
                },
                HAS_ISSUES: {
                    type: 'integer'
                },
            }
        },
    }
};
