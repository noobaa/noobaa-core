export default {
    type: 'array',
    items: {
        type: 'object',
        required: [
            'timestamp',
            'hosts',
            'cloud',
            'internal'
        ],
        properties: {
            timestamp: {
                type: 'integer'
            },
            hosts: {
                $ref: '#/def/common/storage'
            },
            cloud: {
                $ref: '#/def/common/storage'
            },
            internal: {
                $ref: '#/def/common/storage'
            }
        }
    }
};
