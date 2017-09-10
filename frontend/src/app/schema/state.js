export default {
    type: 'object',
    additionalProperties: true,
    properties: {
        location: {
            $ref: '#/def/location'
        },
        session: {
            $ref: '#/def/session'
        },
        buckets: {
            $ref: '#/def/buckets'
        },
        gatewayBuckets: {
            $ref: '#/def/gatewayBuckets'
        },
        internalResources: {
            $ref: '#/def/internalResources'
        },
        namespaceResources: {
            $ref: '#/def/namespaceResources'
        },
        objectUploads: {
            $ref: '#/def/objectUploads'
        },
        cloudTargets: {
            $ref: '#/def/cloudTargets'
        },
        storageHistory: {
            $ref: '#/def/storageHistory'
        },
        topology: {
            $ref: '#/def/topology'
        },
        system: {
            $ref: '#/def/system'
        },
        notifications: {
            $ref: '#/def/notifications'
        },
        alerts: {
            $ref: '#/def/alerts'
        },
        interactiveHelp: {
            $ref: '#/def/interactiveHelp'
        }
    }
};
