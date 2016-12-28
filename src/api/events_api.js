'use strict';

/**
 *
 * EVENT API
 *
 */
module.exports = {

    id: 'events_api',

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
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    till: {
                        format: 'idate'
                    },
                    since: {
                        format: 'idate'
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
                                    format: 'idate'
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
                                        linkable: {
                                            type: 'boolean'
                                        },
                                    }
                                },
                                bucket: {
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
                                pool: {
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
                                obj: {
                                    type: 'object',
                                    required: ['key'],
                                    properties: {
                                        key: {
                                            type: 'string'
                                        }
                                    }
                                },
                                account: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
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
                                actor: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
                                    }
                                },
                                desc: {
                                    type: 'array',
                                    items: {
                                        type: 'string',
                                    }
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
                        format: 'idate'
                    },
                    since: {
                        format: 'idate'
                    }
                }
            },
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        get_unread_alerts_count: {
            method: 'GET',
            reply: {
                type: 'integer'
            },
            auth: {
                system: 'admin',
            }
        },

        mark_alerts_read: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['ids', 'state'],
                properties: {
                    ids: {
                        anyOf: [{
                            type: 'null'
                        }, {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                        }]
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
                    till: {
                        format: 'idate'
                    },
                    since: {
                        format: 'idate'
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
                required: ['alerts'],
                type: 'object',
                properties: {
                    alerts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'time', 'severity', 'alert'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                time: {
                                    format: 'idate'
                                },
                                severity: {
                                    $ref: '#/definitions/alert_severity_enum'
                                },
                                alert: {
                                    type: 'string',
                                },
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        }
    },

    definitions: {
        alert_severity_enum: {
            enum: ['CRIT', 'MAJOR', 'INFO'],
            type: 'string',
        },
    }
};
