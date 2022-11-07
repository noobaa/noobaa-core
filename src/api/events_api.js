/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../util/sensitive_string');

/**
 *
 * EVENT API
 *
 */
module.exports = {

    $id: 'events_api',

    methods: {
        read_activity_log: {
            method: 'GET',
            params: {
                type: 'object',
                required: [],
                properties: {
                    event: {
                        type: 'string',
                    },
                    till: {
                        idate: true
                    },
                    since: {
                        idate: true
                    },
                    skip: {
                        type: 'integer',
                    },
                    limit: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['logs'],
                properties: {
                    logs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'time', 'level', 'event'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                time: {
                                    idate: true
                                },
                                level: {
                                    type: 'string',
                                },
                                event: {
                                    type: 'string',
                                },
                                tier: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                node: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        },
                                        pool: {
                                            type: 'string'
                                        },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                bucket: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: { $ref: 'common_api#/definitions/bucket_name' },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                pool: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        },
                                        resource_type: {
                                            $ref: 'pool_api#/definitions/resource_type'
                                        },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                obj: {
                                    type: 'object',
                                    required: ['key'],
                                    properties: {
                                        bucket: { $ref: 'common_api#/definitions/email' },
                                        key: {
                                            type: 'string'
                                        },
                                        version: {
                                            type: 'string'
                                        },
                                        linkable: {
                                            type: 'boolean'
                                        }
                                    }
                                },
                                account: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: { $ref: 'common_api#/definitions/email' },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                server: {
                                    type: 'object',
                                    properties: {
                                        secret: {
                                            type: 'string'
                                        },
                                        hostname: {
                                            type: 'string'
                                        }
                                    }
                                },
                                func: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                actor: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: { $ref: 'common_api#/definitions/email' },
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                desc: {
                                    type: 'array',
                                    items: { wrapper: SensitiveString }
                                },
                            }
                        }
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        export_activity_log: {
            method: 'GET',
            params: {
                type: 'object',
                required: [],
                properties: {
                    event: {
                        type: 'string',
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    till: {
                        idate: true
                    },
                    since: {
                        idate: true
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['out_path'],
                properties: {
                    out_path: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        get_unread_alerts_count: {
            method: 'GET',
            reply: {
                type: 'object',
                properties: {
                    CRIT: {
                        type: 'integer'
                    },
                    MAJOR: {
                        type: 'integer'
                    },
                    INFO: {
                        type: 'integer'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        update_alerts_state: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['state'],
                properties: {
                    query: {
                        $ref: '#/definitions/alert_query'
                    },
                    state: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        read_alerts: {
            params: {
                type: 'object',
                required: [],
                properties: {
                    query: {
                        $ref: '#/definitions/alert_query'
                    },
                    skip: {
                        type: 'integer',
                    },
                    limit: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['id', 'time', 'severity', 'alert', 'read'],
                    properties: {
                        id: {
                            type: 'string',
                        },
                        time: {
                            idate: true
                        },
                        severity: {
                            $ref: '#/definitions/alert_severity_enum'
                        },
                        alert: {
                            type: 'string',
                        },
                        read: {
                            type: 'boolean',
                        },
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        }
    },

    definitions: {
        alert_query: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                till: {
                    type: 'string'
                },
                since: {
                    type: 'string'
                },
                read: {
                    type: 'boolean'
                },
                severity: {
                    $ref: '#/definitions/alert_severity_enum'
                },
            }
        },

        alert_severity_enum: {
            enum: ['CRIT', 'MAJOR', 'INFO'],
            type: 'string',
        },
    }
};
