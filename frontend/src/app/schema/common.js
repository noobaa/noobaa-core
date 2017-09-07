export const size = {
    oneOf: [
        {
            type: 'integer'
        },
        {
            type: 'object',
            properties: {
                n: {
                    type: 'integer',
                },
                peta: {
                    type: 'integer',
                }
            }
        }
    ]
};

export const storage = {
    type: 'object',
    properties: {
        total: {
            $ref: '#/def/common/size'
        },
        free: {
            $ref: '#/def/common/size'
        },
        spillover_free: {
            $ref: '#/def/common/size'
        },
        unavailable_free: {
            $ref: '#/def/common/size'
        },
        used: {
            $ref: '#/def/common/size'
        },
        used_other: {
            $ref: '#/def/common/size'
        },
        used_reduced: {
            $ref: '#/def/common/size'
        },
        alloc: {
            $ref: '#/def/common/size'
        },
        limit: {
            $ref: '#/def/common/size'
        },
        reserved: {
            $ref: '#/def/common/size'
        },
        real: {
            $ref: '#/def/common/size'
        }
    }
};
