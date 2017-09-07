export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage'
        ],
        properties: {
            name: {
                type: 'string',
            },
            mode: {
                type: 'string',
                enum: [
                    'NO_RESOURCES',
                    'NOT_ENOUGH_HEALTHY_RESOURCES',
                    'NO_CAPACITY',
                    'LOW_CAPACITY',
                    'APPROUCHING_QOUTA',
                    'EXCEEDING_QOUTA',
                    'OPTIMAL'
                ]
            },
            storage: {
                $ref: '#/def/common/storage'
            },
            data: {
                type: 'object',
                properties: {
                    size_reduced: {
                        $ref: '#/def/common/size'
                    },
                    size: {
                        $ref: '#/def/common/size'
                    },
                    free: {
                        $ref: '#/def/common/size'
                    },
                    available_for_upload: {
                        $ref: '#/def/common/size'
                    },
                    spillover_free: {
                        $ref: '#/def/common/size'
                    },
                    last_update: {
                        type: 'integer'
                    }
                }
            },
            quota: {
                type: 'object',
                required: ['size', 'unit'],
                properties: {
                    size: {
                        type: 'integer'
                    },
                    unit: {
                        type: 'string',
                        enum: ['GIGABYTE', 'TERABYTE', 'PETABYTE']
                    },
                }
            }
        }
    }
};
