/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
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
        },
        accounts: {
            $ref: '#/def/accounts'
        },
        env: {
            $ref: '#/def/env'
        },
        forms: {
            $ref: '#/def/forms'
        },
        cloudResources: {
            $ref: '#/def/cloudResources'
        },
        hosts: {
            $ref: '#/def/hosts'
        },
        functions: {
            $ref: '#/def/functions'
        },
        bucketUsageHistory: {
            $ref: '#/def/bucketUsageHistory'
        },
        accountUsageHistory: {
            $ref: '#/def/accountUsageHistory'
        },
        lambdaUsageHistory: {
            $ref: '#/def/lambdaUsageHistory'
        },
        objectsDistribution: {
            ref: '#/def/objectsDistribution'
        },
        cloudUsageStats: {
            ref: '#/def/cloudUsageStats'
        },
        platform: {
            ref: '#/def/platform'
        }
    }
};
