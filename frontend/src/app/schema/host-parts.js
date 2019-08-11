/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'host',
        'partCount',
        'fetching',
        'error'
    ],
    properties: {
        host: {
            type: 'string'
        },
        parts: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'mode',
                    'objectInfo',
                    'start',
                    'end'
                ],
                properties: {
                    mode: {
                        type: 'string',
                        enum: [
                            'AVAILABLE',
                            'BUILDING',
                            'UNAVAILABLE'
                        ]
                    },
                    objectInfo: {
                        type: 'object',
                        required: [
                            'bucket',
                            'key',
                            'version',
                            'isUploading',
                            'isDeleteMarker'
                        ],
                        properties: {
                            bucket: {
                                type: 'string'
                            },
                            key: {
                                type: 'string'
                            },
                            version: {
                                type: 'string'
                            },
                            isUploading: {
                                type: 'boolean'
                            },
                            isDeleteMarker: {
                                type: 'boolean'
                            }
                        }
                    },
                    start: {
                        type: 'integer'
                    },
                    end: {
                        type: 'integer'
                    }
                }
            }
        },
        skip: {
            type: 'integer'
        },
        limit: {
            type: 'integer'
        },
        partCount: {
            type: 'integer'
        },
        fetching: {
            type: 'boolean'
        },
        error: {
            type: 'boolean'
        }
    }
};
