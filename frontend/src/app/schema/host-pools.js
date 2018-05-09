export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage',
            'associatedAccounts',
            'connectedBuckets',
            'hostCount',
            'hostsByMode',
            'activities'
        ],
        properties: {
            name: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'HAS_NO_NODES',
                    'ALL_NODES_OFFLINE',
                    'NO_CAPACITY',
                    'ALL_HOSTS_IN_PROCESS',
                    'MOST_NODES_ISSUES',
                    'MANY_NODES_ISSUES',
                    'MOST_STORAGE_ISSUES',
                    'MANY_STORAGE_ISSUES',
                    'MOST_S3_ISSUES',
                    'MANY_S3_ISSUES',
                    'MANY_NODES_OFFLINE',
                    'LOW_CAPACITY',
                    'HIGH_DATA_ACTIVITY',
                    'IO_ERRORS',
                    'STORAGE_NOT_EXIST',
                    'AUTH_FAILED',
                    'INITIALIZING',
                    'OPTIMAL'
                ]
            },
            activities: {
                type: 'object',
                required: [
                    'hostCount',
                    'list'
                ],
                properties: {
                    hostCount: {
                        type: 'integer'
                    },
                    list: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'kind',
                                'nodeCount'
                            ],
                            properties: {
                                kind: {
                                    type: 'string',
                                    enum: [
                                        'RESTORING',
                                        'MIGRATING',
                                        'DECOMMISSIONING',
                                        'DELETING'
                                    ]
                                },
                                nodeCount: {
                                    type: 'integer'
                                },
                                progress: {
                                    type: 'number',
                                    minimum: 0,
                                    maximum: 1
                                },
                                eta: {
                                    type: 'integer'
                                }
                            }
                        }
                    }
                }
            },
            associatedAccounts: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            connectedBuckets: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            hostCount: {
                type: 'integer'
            },
            hostsByMode: {
                type: 'object',
                additionalProperties: {
                    type: 'integer'
                }
            },
            storage: {
                $ref: '#/def/common/storage'
            },
            undeletable: {
                type: 'string',
                enum: [
                    'SYSTEM_ENTITY',
                    'NOT_EMPTY',
                    'IN_USE',
                    'DEFAULT_RESOURCE'
                ]
            }
        }
    }
};
