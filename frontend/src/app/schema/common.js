/* Copyright (C) 2016 NooBaa */

export const size = {
    oneOf: [
        {
            type: 'integer'
        },
        {
            type: 'object',
            properties: {
                n: {
                    type: 'integer'
                },
                peta: {
                    type: 'integer'
                }
            }
        }
    ]
};

export const storage = {
    type: 'object',
    properties: {
        lastUpdate: {
            type: 'integer'
        },
        total: {
            $ref: '#/def/common/size'
        },
        free: {
            $ref: '#/def/common/size'
        },
        spilloverFree: {
            $ref: '#/def/common/size'
        },
        unavailableFree: {
            $ref: '#/def/common/size'
        },
        used: {
            $ref: '#/def/common/size'
        },
        unavailableUsed: {
            $ref: '#/def/common/size'
        },
        usedOther: {
            $ref: '#/def/common/size'
        },
        reserved: {
            $ref: '#/def/common/size'
        }
    }
};

export const serviceCheckResult = {
    type: 'string',
    enum: [
        'UNKNOWN',
        'FAULTY',
        'UNREACHABLE',
        'OPERATIONAL'
    ]
};

export const port = {
    type: 'integer',
    minimum: 0,
    maximum: 65535
};
