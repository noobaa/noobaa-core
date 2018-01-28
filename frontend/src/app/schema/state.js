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
        namespaceBuckets: {
            $ref: '#/def/namespaceBuckets'
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
        drawer: {
            $ref: '#/def/drawer'
        },
        modals: {
            $ref: '#/def/modals'
        },
        hostParts: {
            $ref: '#/def/hostParts'
        },
        hostPools: {
            $ref: '#/def/hostPools'
        },
        objects: {
            $ref: '#/def/objects'
        },
        objectParts: {
            $ref: '#/def/objectParts'
        }
    }
};
