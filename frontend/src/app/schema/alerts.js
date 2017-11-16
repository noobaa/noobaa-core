export default {
    type: 'object',
    required: [
        'loading',
        'loadError',
        'filter',
        'list',
        'endOfList',
        'unreadCounts'
    ],
    properties: {
        loading: {
            type: 'number'
        },
        loadError: {
            oneOf: [
                {
                    type: 'null'
                },
                {
                    type: 'string'
                }
            ]
        },
        filter: {
            type: 'object',
            properties: {
                read: {
                    type: 'boolean'
                },
                severity: {
                    type: 'string',
                    enum: [
                        'CRIT',
                        'MAJOR',
                        'INFO'
                    ]
                }
            }
        },
        list: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'alert',
                    'id',
                    'read',
                    'severity',
                    'time'
                ],
                properties: {
                    alert: {
                        type: 'string'
                    },
                    id: {
                        type: 'string'
                    },
                    read: {
                        type: 'boolean'
                    },
                    severity: {
                        type: 'string',
                        enum: [
                            'CRIT',
                            'MAJOR',
                            'INFO'
                        ]
                    },
                    time: {
                        type: 'number'
                    },
                    updating: {
                        type: 'boolean'
                    }
                }
            }
        },
        endOfList: {
            type: 'boolean'
        },
        unreadCounts: {
            type: 'object',
            properties: {
                crit: {
                    type: 'number'
                },
                major: {
                    type: 'number'
                },
                info: {
                    type: 'number'
                }
            }
        }
    }
};
