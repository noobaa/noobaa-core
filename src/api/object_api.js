// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api.define_api({

    name: 'Object',

    methods: {

        // bucket functions

        create_bucket: {
            method: 'POST',
            path: '/',
            params: {
                type: 'object',
                required: ['bucket'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    }
                }
            }
        },

        read_bucket: {
            method: 'GET',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: {
                    name: {
                        type: 'string'
                    }
                }
            }
        },

        update_bucket: {
            method: 'PUT',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
        },

        delete_bucket: {
            method: 'DELETE',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
        },

        list_bucket_objects: {
            method: 'GET',
            path: '/:bucket/list',
            params: {
                type: 'object',
                required: ['bucket'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['objects'],
                additionalProperties: false,
                properties: {
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['key', 'size', 'create_time'],
                            additionalProperties: false,
                            properties: {
                                key: {
                                    type: 'string',
                                },
                                size: {
                                    type: 'number',
                                },
                                create_time: {
                                    type: 'string',
                                    format: 'date',
                                },
                            }
                        }
                    }
                }
            }
        },

        // object functions

        create_object: {
            method: 'POST',
            path: '/:bucket',
            params: {
                type: 'object',
                required: ['bucket', 'key', 'size'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    size: {
                        type: 'number',
                    },
                }
            },
        },

        read_object_md: {
            method: 'GET',
            path: '/:bucket/:key',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        update_object_md: {
            method: 'PUT',
            path: '/:bucket/:key',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        delete_object: {
            method: 'DELETE',
            path: '/:bucket/:key',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                }
            },
        },

        map_object: {
            method: 'GET',
            path: '/:bucket/:key/map',
            params: {
                type: 'object',
                required: ['bucket', 'key'],
                additionalProperties: false,
                properties: {
                    bucket: {
                        type: 'string',
                    },
                    key: {
                        type: 'string',
                    },
                    offset: {
                        type: 'number',
                    },
                    size: {
                        type: 'number',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['key', 'size', 'create_time', 'parts'],
                additionalProperties: false,
                properties: {
                    key: {
                        type: 'string'
                    },
                    size: {
                        type: 'number'
                    },
                    create_time: {
                        type: 'string',
                        format: 'date',
                    },
                    parts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                offset: {
                                    type: 'number',
                                },
                                size: {
                                    type: 'number',
                                },
                                kblocks: {
                                    type: 'number',
                                },
                                word_size: {
                                    type: 'number',
                                },
                                // blocks
                            }
                        },
                    },
                }
            }
        },

    }

});
