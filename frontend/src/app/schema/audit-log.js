/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'loading',
        'loadError',
        'categories',
        'list',
        'endOfList',
        'selectedRecord'
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
        categories: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        list: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'time',
                    'category',
                    'event',
                    'desc'
                ],
                properties: {
                    id: {
                        type: 'string'
                    },
                    time: {
                        type: 'integer'
                    },
                    actor: {
                        type: 'object',
                        required: [
                            'name',
                            'linkable'
                        ],
                        properties: {
                            name: {
                                type: 'string'
                            },
                            linkable: {
                                type: 'boolean'
                            }
                        }
                    },
                    category: {
                        type: 'event'
                    },
                    event: {
                        type: 'string'
                    },
                    entity: {
                        type: 'object',
                        required: [
                            'kind',
                            'linkable'
                        ],
                        properties: {
                            'kind': {
                                type: 'string',
                                enum: [
                                    'node',
                                    'object',
                                    'bucket',
                                    'account',
                                    'resource',
                                    'server',
                                    'func'
                                ]
                            },
                            linkable: {
                                type: 'boolean'
                            }
                        },
                        additionalProperties: {
                            type: 'string'
                        }
                    },
                    desc: {
                        type: 'string'
                    }
                }
            }
        },
        endOfList: {
            type: 'boolean'
        },
        selectedRecord: {
            type: 'string'
        }
    }
};
