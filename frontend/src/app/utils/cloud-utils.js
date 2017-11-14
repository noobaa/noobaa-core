import { deepFreeze } from './core-utils';

const serviceToMeta = deepFreeze({
    AWS: {
        displayName: 'AWS S3 service',
        subject: 'Bucket',
        icon: 'aws-s3-dark',
        selectedIcon: 'aws-s3-colored'
    },
    AZURE: {
        displayName: 'Azure Blob Service',
        subject: 'Container',
        icon: 'azure-dark',
        selectedIcon: 'azure-colored'
    },
    S3_COMPATIBLE: {
        displayName: 'S3 Compatible service',
        subject: 'Bucket',
        icon: 'cloud-dark',
        selectedIcon: 'cloud-colored'
    },
    NET_STORAGE: {
        displayName: 'NetStorage service',
        subject: 'Bucket',
        icon: 'net-storage'
    }
});

const usedCloudTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
    CLOUD_SYNC: name => `Already used by bucket's ${name} cloud sync policy`,
    NAMESPACE_RESOURCE: name => `Already used by ${name} namespace resource `
});

export function getCloudServiceMeta(service) {
    return serviceToMeta[service];
}

export function getCloudTargetTooltip(cloudTarget) {
    if (!cloudTarget.usedBy) return '';

    const { kind, name } = cloudTarget.usedBy;
    return usedCloudTargetTooltip[kind](name);
}
