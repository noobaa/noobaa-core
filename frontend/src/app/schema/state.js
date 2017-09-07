export default {
    type: 'object',
    additionalProperties: true,
    properties: {
        session: {
            $ref: '#/def/session'
        },
        location: {
            $ref: '#/def/location'
        },
        buckets: {
            $ref: '#/def/buckets'
        },
        objectUploads: {
            $ref: '#/def/objectUploads'
        },
        internalResources: {
            $ref: '#/def/internalResources'
        }
    },
};
