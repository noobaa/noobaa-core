/* Copyright (C) 2016 NooBaa */

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
    GOOGLE: {
        displayName: 'Google Cloud Service',
        subject: 'Bucket',
        icon: 'google-cloud-dark',
        selectedIcon: 'google-cloud-colored'
    },
    S3_V2_COMPATIBLE: {
        displayName: 'S3 V2 Compatible service',
        subject: 'Bucket',
        icon: 'cloud-v2-dark',
        selectedIcon: 'cloud-v2-colored'
    },
    S3_V4_COMPATIBLE: {
        displayName: 'S3 V4 Compatible service',
        subject: 'Bucket',
        icon: 'cloud-v4-dark',
        selectedIcon: 'cloud-v4-colored'
    },
    NET_STORAGE: {
        displayName: 'NetStorage service',
        subject: 'Bucket',
        icon: 'net-storage'
    }
});

const usedCloudTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
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
