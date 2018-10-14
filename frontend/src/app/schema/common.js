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
    minimum: 1,
    maximum: 65535
};

export const diagnostics = {
    type: 'object',
    required: [
        'collecting',
        'error',
        'packageUri'
    ],
    properties: {
        collecting: {
            type: 'boolean'
        },
        error: {
            type: 'boolean'
        },
        packageUri: {
            type: 'string'
        }
    }
};

export const bufferKey = {
    oneOf: [
        {
            type: 'null'
        },
        {
            type: 'object',
            required: [
                'key'
            ],
            properties: {
                key: {
                    type: 'string'
                }
            }
        }
    ]
};

export const lambdaFuncStats = {
    type: 'object',
    required: [
        'since',
        'till',
        'invoked',
        'fulfilled',
        'rejected',
        'aggrResponseTime',
        'maxResponseTime',
        'avgResponseTime',
        'responsePercentiles'
    ],
    properties: {
        since: {
            type: 'integer'
        },
        till: {
            type: 'integer'
        },
        invoked: {
            type: 'integer'
        },
        fulfilled: {
            type: 'integer'
        },
        rejected: {
            type: 'integer'
        },
        aggrResponseTime: {
            type: 'integer'
        },
        maxResponseTime: {
            type: 'integer'
        },
        avgResponseTime: {
            type: 'integer'
        },
        responsePercentiles: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'percentile',
                    'value'
                ],
                properties: {
                    percentile: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1
                    },
                    value: {
                        type: 'integer'
                    }
                }
            }
        }
    }
};
