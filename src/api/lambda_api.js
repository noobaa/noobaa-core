/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * LAMBDA API
 *
 */
module.exports = {

    id: 'lambda_api',

    methods: {

        create_function: {
            method: 'POST',
            params: {
                $ref: '#/definitions/function_info'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_function: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

        read_function: {
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
                $ref: '#/definitions/function_info'
            },
            auth: {
                system: 'admin'
            }
        },

        list_functions: {
            method: 'GET',
            reply: {
                type: 'object',
                properties: {
                    functions: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/function_info'
                        }
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        invoke_function: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
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
                system: 'admin'
            }
        },

        /*
        allocate_function_maps: {
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
                $ref: '#/definitions/function_info'
            },
            auth: {
                system: 'admin'
            }
        },
        */

    },

    definitions: {

        function_info: {
            type: 'object',
            required: [
                'name',
                'runtime',
                'handler',
            ],
            properties: {
                name: {
                    type: 'string'
                },
                runtime: {
                    type: 'string',
                    enum: [
                        'nodejs',
                        'nodejs4.3',
                        // 'java8',
                        // 'python2.7',
                    ]
                },
                role: {
                    type: 'string'
                },
                handler: {
                    type: 'string'
                },
                description: {
                    type: 'string'
                },
                memory_size: {
                    type: 'integer'
                },
                timeout: {
                    type: 'integer'
                },
                code: {
                    type: 'object',
                    properties: {
                        zipfile: {
                            buffer: true
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
            },
        },

    }

};
