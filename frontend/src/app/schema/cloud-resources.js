/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage',
            'target',
            'type',
            'usedBy',
            'associatedAccounts',
            'createdBy',
            'creationTime',
            'internalHost',
            'io'
        ],
        properties: {
            name: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'OPTIMAL',
                    'INITIALIZING',
                    'IO_ERRORS',
                    'ALL_NODES_OFFLINE',
                    'STORAGE_NOT_EXIST',
                    'AUTH_FAILED'
                ]
            },
            storage: {
                $ref: '#/def/common/storage'
            },
            target: {
                type: 'string'
            },
            type: {
                type: 'string',
                enum: [
                    'AWS',
                    'AZURE',
                    'S3_COMPATIBLE',
                    'GOOGLE',
                    'FLASHBLADE'
                ]
            },
            region: {
                type: 'string'
            },
            undeletable: {
                type: 'string',
                enum: [
                    'NOT_EMPTY',
                    'IN_USE',
                    'DEFAULT_RESOURCE'
                ]
            },
            usedBy: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            associatedAccounts: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            createdBy: {
                type: 'string'
            },
            creationTime: {
                type: 'integer'
            },
            'internalHost': {
                type: 'string'
            },
            io: {
                type: 'object',
                requires: [
                    'readCount',
                    'readSize',
                    'writeCount',
                    'writeSize'
                ],
                properties: {
                    readCount: {
                        type: 'integer'
                    },
                    readSize: {
                        $ref: '#/def/common/size'
                    },
                    writeCount: {
                        type: 'integer'
                    },
                    writeSize: {
                        $ref: '#/def/common/size'
                    }
                }
            }
        }
    }
};
