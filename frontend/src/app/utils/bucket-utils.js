/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isUndefined } from './core-utils';
import { toBigInteger, fromBigInteger, bigInteger, unitsInBytes } from 'utils/size-utils';
import { stringifyAmount, pluralize } from 'utils/string-utils';

const bucketStateToIcon = deepFreeze({
    NO_RESOURCES: {
        tooltip: 'No available resources',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_HEALTHY_RESOURCES: {
        tooltip: 'Not enough healthy storage resources',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_RESOURCES: {
        tooltip: 'Not enough drives to meet resiliency policy',
        css: 'error',
        name: 'problem'
    },
    NO_CAPACITY: {
        tooltip: 'No potential available storage',
        css: 'error',
        name: 'problem'
    },
    EXCEEDING_QOUTA: {
        tooltip: 'Exceeded configured quota',
        css: 'error',
        name: 'problem'
    },
    SPILLOVER_NO_RESOURCES: {
        tooltip: 'No available resources - using spillover',
        css: 'warning',
        name: 'problem'
    },
    SPILLOVER_NOT_ENOUGH_HEALTHY_RESOURCES: {
        tooltip: 'Not enough healthy storage resources - using spillover',
        css: 'warning',
        name: 'problem'
    },
    SPILLOVER_NOT_ENOUGH_RESOURCES: {
        tooltip: 'Not enough drives to meet resiliency policy - using spillover',
        css: 'warning',
        name: 'problem'
    },
    SPILLOVER_NO_CAPACITY: {
        tooltip: 'No potential available storage - using spillover',
        css: 'warning',
        name: 'problem'
    },
    LOW_CAPACITY: {
        tooltip: 'Storage is low',
        css: 'warning',
        name: 'problem'
    },
    APPROUCHING_QOUTA: {
        tooltip: 'Approaching configured quota',
        css: 'warning',
        name: 'problem'
    },
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    }
});

const cloudSyncStateToText = deepFreeze({
    NOTSET: {
        text: 'not set',
        css: ''
    },
    PENDING: {
        text: 'waiting',
        css: ''
    },
    SYNCING: {
        text: 'syncing',
        css: ''
    },
    PAUSED: {
        text: 'paused',
        css: ''
    },
    SYNCED: {
        text: 'synced',
        css: ''
    },
    UNABLE: {
        text: 'unable to sync',
        css: 'error'
    }
});

const placementTypeToDisplayName = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

const namespaceBucketToStateIcon = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const resiliencyTypeToDisplay = deepFreeze({
    REPLICATION: 'Replication',
    ERASURE_CODING: 'Erasure Coding'
});

const writableStates = deepFreeze([
    'LOW_CAPACITY',
    'APPROUCHING_QOUTA',
    'SPILLOVER_NO_RESOURCES',
    'SPILLOVER_NOT_ENOUGH_HEALTHY_RESOURCES',
    'SPILLOVER_NOT_ENOUGH_RESOURCES',
    'SPILLOVER_NO_CAPACITY',
    'OPTIMAL'
]);

const resiliencyTypeToBlockType = deepFreeze({
    REPLICATION: 'replica',
    ERASURE_CODING: 'fragment'
});

export const bucketEvents = deepFreeze([
    {
        value: 'ObjectCreated',
        label: 'Object Created'
    },
    {
        value: 'ObjectRemoved',
        label: 'Object Removed'
    }
]);

export function getBucketStateIcon(bucket, align) {
    if (isUndefined(align)) {
        return bucketStateToIcon[bucket.mode];
    } else {
        const { tooltip, ...rest } = bucketStateToIcon[bucket.mode];
        return {
            ...rest,
            tooltip: {
                text: tooltip,
                align
            }
        };
    }
}

export function getCloudSyncState(bucket) {
    const state = bucket.cloudSync ? bucket.cloudSync.state.mode : 'NOTSET';
    return cloudSyncStateToText[state];
}

export function getPlacementTypeDisplayName(type) {
    return placementTypeToDisplayName[type];
}

export function getNamespaceBucketStateIcon(bucket) {
    const { mode } = bucket;
    return namespaceBucketToStateIcon[mode];
}

export function getDataBreakdown(data, qouta) {
    if (!qouta) {
        return {
            used: data.size,
            overused: 0,
            availableForUpload: data.availableForUpload,
            potentialForUpload: 0,
            availableForSpillover: data.availableForSpillover,
            potentialForSpillover: 0,
            overallocated: 0
        };
    }

    const { zero, max, min } = bigInteger;
    const sizeBigInt = toBigInteger(data.size);
    const uploadBigInt = toBigInteger(data.availableForUpload);
    const spilloverBigInt = toBigInteger(data.availableForSpillover);

    let q = toBigInteger(qouta.size).multiply(unitsInBytes[qouta.unit]);
    const used = min(sizeBigInt, q);
    const overused = sizeBigInt.subtract(used);

    q = max(q.subtract(sizeBigInt), zero);
    const availableForUpload = min(uploadBigInt, q);
    const potentialForUpload = uploadBigInt.subtract(availableForUpload);

    q = max(q.subtract(uploadBigInt), zero);
    const availableForSpillover = min(spilloverBigInt, q);
    const potentialForSpillover = spilloverBigInt.subtract(availableForSpillover);

    const overallocated = max(q.subtract(spilloverBigInt), zero);

    return {
        used: fromBigInteger(used),
        overused: fromBigInteger(overused),
        availableForUpload: fromBigInteger(availableForUpload),
        potentialForUpload: fromBigInteger(potentialForUpload),
        availableForSpillover: fromBigInteger(availableForSpillover),
        potentialForSpillover: fromBigInteger(potentialForSpillover),
        overallocated: fromBigInteger(overallocated)
    };
}

export function getQuotaValue(qouta) {
    const { size, unit } = qouta;
    const qoutaBigInt = toBigInteger(size).multiply(unitsInBytes[unit]);
    return fromBigInteger(qoutaBigInt);
}

export function isBucketWritable(bucket) {
    return writableStates.includes(bucket.mode);
}

export function summrizeResiliency(resiliency) {
    switch (resiliency.kind) {
        case 'REPLICATION': {
            const replicas = Math.max(resiliency.replicas, 0);
            const copies = Math.max(replicas - 1, 0);
            return {
                type: 'REPLICATION',
                replicas: replicas,
                storageOverhead: copies,
                failureTolerance: copies,
                requiredDrives: replicas,
                rebuildEffort: 'LOW'
            };
        }
        case 'ERASURE_CODING': {
            const dataFrags = Math.max(resiliency.dataFrags, 0);
            const parityFrags = Math.max(resiliency.parityFrags, 0);
            return {
                type: 'ERASURE_CODING',
                dataFrags: dataFrags,
                parityFrags: parityFrags,
                storageOverhead: dataFrags > 0 ? parityFrags / dataFrags : 0,
                failureTolerance: parityFrags,
                requiredDrives: dataFrags + parityFrags,
                rebuildEffort: dataFrags <= 4 ? 'HIGH' : 'VERY_HIGH'
            };
        }
    }
}

export function getResiliencyTypeDisplay(resiliencyType) {
    return resiliencyTypeToDisplay[resiliencyType];
}


export function getResiliencyRequirementsWarning(resiliencyType, drivesCount) {
    const subject = resiliencyTypeToBlockType[resiliencyType];

    return `The current placement policy allows for a maximum of ${
        stringifyAmount(subject, drivesCount)
    }. The number of possible ${
        pluralize(subject)
    } is derived from the minimal number of available drives across all mirror sets.`;
}
