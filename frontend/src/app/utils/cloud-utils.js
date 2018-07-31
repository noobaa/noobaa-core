/* Copyright (C) 2016 NooBaa */

import { deepFreeze, keyByProperty } from './core-utils';

export const cloudServices = deepFreeze([
    {
        value: 'AWS',
        displayName: 'AWS S3',
        subject: 'Bucket',
        icon: 'aws-s3-dark',
        selectedIcon: 'aws-s3-colored',
        defaultEndpoint: 'https://s3.amazonaws.com'
    },
    {
        value: 'AZURE',
        displayName: 'Azure Blob',
        subject: 'Container',
        icon: 'azure-dark',
        selectedIcon: 'azure-colored',
        defaultEndpoint: 'https://blob.core.windows.net'
    },
    {
        value: 'GOOGLE',
        displayName: 'Google Cloud',
        subject: 'Bucket',
        icon: 'google-cloud-dark',
        selectedIcon: 'google-cloud-colored',
        defaultEndpoint: 'www.googleapis.com'
    },
    {
        value: 'S3_V2_COMPATIBLE',
        displayName: 'S3 V2 Compatible service',
        subject: 'Bucket',
        icon: 'cloud-v2-dark',
        selectedIcon: 'cloud-v2-colored'
    },
    {
        value: 'S3_V4_COMPATIBLE',
        displayName: 'S3 V4 Compatible service',
        subject: 'Bucket',
        icon: 'cloud-v4-dark',
        selectedIcon: 'cloud-v4-colored'
    },
    {
        value: 'NET_STORAGE',
        displayName: 'NetStorage service',
        subject: 'Bucket',
        icon: 'net-storage'
    },
    {
        value: 'FLASHBLADE',
        displayName: 'Pure FlashBlade service',
        subject: 'Bucket',
        icon: 'google-cloud-dark', //NBNB
        selectedIcon: 'google-cloud-colored' //NBNB
    }
]);

const usedCloudTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
    NAMESPACE_RESOURCE: name => `Already used by ${name} namespace resource `
});

const serviceToMeta  = keyByProperty(cloudServices, 'value');

export function getCloudServiceMeta(service) {
    return serviceToMeta[service];
}

export function getCloudTargetTooltip(cloudTarget) {
    if (!cloudTarget.usedBy) return '';

    const { kind, name } = cloudTarget.usedBy;
    return usedCloudTargetTooltip[kind](name);
}
