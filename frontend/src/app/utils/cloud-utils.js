import { deepFreeze } from './core-utils';

const serviceToMeta = deepFreeze({
    AWS: {
        subject: 'Bucket',
        icon: 'aws-s3-resource-dark',
        selectedIcon: 'aws-s3-resource-colored'
    },
    AZURE: {
        subject: 'Container',
        icon: 'azure-resource-dark',
        selectedIcon: 'azure-resource-colored'
    },
    S3_COMPATIBLE: {
        subject: 'Bucket',
        icon: 'cloud-resource-dark',
        selectedIcon: 'cloud-resource-colored'
    }
});

const usedCloudTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
    CLOUD_SYNC: name => `Already used by bucket's ${name} cloud sync policy`,
    NAMESPACE_RESOURCE: name => `Already used by ${name} namespace resource `,
});

export function getCloudServiceMeta(service) {
    return serviceToMeta[service];
}

export function getCloudTargetTooltip(cloudTarget) {
    if (!cloudTarget.usedBy) return '';

    const { kind, name } = cloudTarget.usedBy;
    return usedCloudTargetTooltip[kind](name);
}
