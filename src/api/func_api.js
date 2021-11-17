/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * FUNC API
 *
 */
module.exports = {

    $id: 'func_api',

    methods: {

        create_func: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['config', 'code'],
                properties: {
                    config: {
                        $ref: '#/definitions/func_config'
                    },
                    code: {
                        $ref: '#/definitions/func_code'
                    },
                    publish: {
                        type: 'boolean'
                    },
                }
            },
            reply: {
                $ref: '#/definitions/func_info'
            },
            auth: {
                system: 'admin'
            }
        },

        update_func: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['config'],
                properties: {
                    config: {
                        $ref: '#/definitions/func_config'
                    },
                    code: {
                        $ref: '#/definitions/func_code'
                    },
                }
            },
            reply: {
                $ref: '#/definitions/func_info'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_func: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'version'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        read_func: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name', 'version'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    read_code: {
                        type: 'boolean'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['config', 'code_location'],
                properties: {
                    config: {
                        $ref: '#/definitions/func_config'
                    },
                    code_location: {
                        $ref: '#/definitions/func_code_location'
                    },
                    code: {
                        $ref: '#/definitions/func_code'
                    }
                }
            },
            auth: {
                system: ['admin', 'agent']
            }
        },

        read_func_stats: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'name',
                    'version',
                    'since',
                    'step'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    since: {
                        idate: true
                    },
                    till: {
                        idate: true
                    },
                    step: {
                        type: 'integer'
                    },
                    percentiles: {
                        type: 'array',
                        items: {
                            type: 'number',
                            minimum: 0,
                            maximum: 1
                        }
                    },
                    max_samples: {
                        type: 'integer'
                    },
                }
            },
            reply: {
                type: 'object',
                required: [
                    'stats',
                    'slices'
                ],
                properties: {
                    stats: {
                        $ref: '#/definitions/func_stats'
                    },
                    slices: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/func_stats'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        list_funcs: {
            method: 'GET',
            reply: {
                type: 'object',
                properties: {
                    functions: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/func_info'
                        }
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        list_func_versions: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                },
            },
            reply: {
                type: 'object',
                properties: {
                    versions: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/func_info'
                        }
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        invoke_func: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'version'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    event: {
                        $ref: '#/definitions/event_type'
                    }
                },
            },
            reply: {
                type: 'object',
                properties: {
                    result: {
                        $ref: '#/definitions/event_type'
                    },
                    error: {
                        $ref: '#/definitions/error_type'
                    }
                }
            },
            auth: {
                system: ['admin', 'agent']
            }
        },

        /*
        allocate_func_maps: {
            method: 'PUT',
            params: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string'
                    }
                },
            },
            reply: {
                $ref: '#/definitions/func_info'
            },
            auth: {
                system: 'admin'
            }
        },
        */

    },

    definitions: {

        func_config: {
            type: 'object',
            required: ['name', 'version'],
            properties: {
                name: {
                    type: 'string'
                },
                version: {
                    type: 'string'
                },
                exec_account: { $ref: 'common_api#/definitions/email' },
                description: {
                    type: 'string'
                },
                role: {
                    type: 'string'
                },
                handler: {
                    type: 'string'
                },
                runtime: {
                    type: 'string'
                },
                memory_size: {
                    type: 'integer'
                },
                timeout: {
                    type: 'integer'
                },
                pools: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                // the following fields are not configurable,
                // and will be returned as info
                code_size: {
                    type: 'integer'
                },
                code_sha256: {
                    type: 'string'
                },
                last_modified: {
                    idate: true
                },
                last_modifier: { $ref: 'common_api#/definitions/email' },
                resource_name: {
                    type: 'string'
                },
            }
        },

        func_code: {
            type: 'object',
            properties: {
                zipfile_b64: {
                    type: 'string'
                },
                s3_bucket: {
                    type: 'string'
                },
                s3_key: {
                    type: 'string'
                },
                s3_obj_version: {
                    type: 'string'
                },
                s3_endpoint: {
                    type: 'string'
                },
                url: {
                    type: 'string'
                },
            }
        },

        func_code_location: {
            type: 'object',
            required: ['url', 'repository'],
            properties: {
                url: {
                    type: 'string'
                },
                repository: {
                    type: 'string'
                },
            }
        },

        func_info: {
            type: 'object',
            required: ['config', 'code_location'],
            properties: {
                config: {
                    $ref: '#/definitions/func_config'
                },
                code_location: {
                    $ref: '#/definitions/func_code_location'
                },
            }
        },

        event_type: {
            oneOf: [{
                type: 'object',
                additionalProperties: true,
                properties: {},
            }, {
                type: 'string'
            }]
        },

        error_type: {
            type: 'object',
            required: ['message'],
            properties: {
                message: {
                    type: 'string'
                },
                stack: {
                    type: 'string'
                },
                code: {
                    type: 'string'
                },
            },
        },

        func_stats: {
            type: 'object',
            required: [
                'since',
                'till',
                'invoked',
                'fulfilled',
                'rejected',
                'aggr_response_time',
                'max_response_time',
                'avg_response_time',
                'response_percentiles'
            ],
            properties: {
                since: {
                    idate: true
                },
                till: {
                    idate: true
                },
                invoked: {
                    type: 'integer'
                },
                fulfilled: {
                    type: 'integer'
                },
                rejected: {
                    type: 'integer'
                },
                aggr_response_time: {
                    type: 'integer'
                },
                max_response_time: {
                    type: 'integer'
                },
                avg_response_time: {
                    type: 'integer'
                },
                response_percentiles: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: [
                            'percentile',
                            'value'
                        ],
                        properties: {
                            percentile: {
                                type: 'number',
                                minimum: 0,
                                maximum: 1
                            },
                            value: {
                                type: 'integer'
                            }
                        }
                    }
                }
            }
        }
    }
};
