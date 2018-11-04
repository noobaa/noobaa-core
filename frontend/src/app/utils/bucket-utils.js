/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isUndefined, sumBy, flatMap, mapValues } from './core-utils';
import { toBigInteger, fromBigInteger, bigInteger, unitsInBytes } from 'utils/size-utils';
import { stringifyAmount, pluralize } from 'utils/string-utils';

const bucketStateToIcon = deepFreeze(
    _mapObjectsToFunction({
        NO_RESOURCES: {
            tooltip: 'No storage resources',
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
        EXCEEDING_QUOTA: {
            tooltip: 'Exceeded configured quota',
            css: 'error',
            name: 'problem'
        },
        LOW_CAPACITY: {
            tooltip: 'Storage is low',
            css: 'warning',
            name: 'problem'
        },
        RISKY_TOLERANCE: {
            tooltip: 'Risky failure tolerance ',
            css: 'warning',
            name: 'problem'
        },
        NO_RESOURCES_INTERNAL: {
            tooltip: 'No Storage Resources - Using Internal Storage',
            css: 'warning',
            name: 'problem'
        },
        APPROUCHING_QUOTA: {
            tooltip: 'Approaching configured quota',
            css: 'warning',
            name: 'problem'
        },
        DATA_ACTIVITY: {
            tooltip: 'In process',
            css: 'warning',
            name: 'working'
        },
        MANY_TIERS_ISSUES: {
            tooltip: 'Tiers Resources has Issues ',
            css: 'warning',
            name: 'problem'
        },
        ONE_TIER_ISSUES: bucket => {
            const i = bucket.placement2.tiers.findIndex(tier =>
                tier.mode !== 'OPTIMAL'
            );

            return {
                tooltip: `Tier ${i + 1}'s Resources has Issues`,
                css: 'warning',
                name: 'problem'
            };
        },
        OPTIMAL: {
            tooltip: 'Healthy',
            css: 'success',
            name: 'healthy'
        }
    })
);

const placementModeToIcon = deepFreeze({
    INTERNAL_ISSUES: {
        tooltip: {
            text: 'TODO: some text',
            align: 'start'
        },
        css: 'error',
        name: 'problem'
    },
    NO_RESOURCES: _alignIconTooltip(bucketStateToIcon.NO_RESOURCES(), 'start'),
    NOT_ENOUGH_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_RESOURCES(), 'start'),
    NOT_ENOUGH_HEALTHY_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_HEALTHY_RESOURCES(), 'start'),
    NO_CAPACITY: _alignIconTooltip(bucketStateToIcon.NO_CAPACITY(), 'start'),
    RISKY_TOLERANCE: _alignIconTooltip(bucketStateToIcon.RISKY_TOLERANCE(), 'start'),
    LOW_CAPACITY: _alignIconTooltip(bucketStateToIcon.LOW_CAPACITY(), 'start'),
    DATA_ACTIVITY: _alignIconTooltip(bucketStateToIcon.DATA_ACTIVITY(), 'start'),
    OPTIMAL: _alignIconTooltip(bucketStateToIcon.OPTIMAL(), 'start')
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

const resiliencyModeToIcon = deepFreeze({
    NOT_ENOUGH_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_RESOURCES(), 'start'),
    RISKY_TOLERANCE: _alignIconTooltip(bucketStateToIcon.RISKY_TOLERANCE(), 'start'),
    DATA_ACTIVITY: _alignIconTooltip(bucketStateToIcon.DATA_ACTIVITY(), 'start'),
    OPTIMAL: _alignIconTooltip(bucketStateToIcon.OPTIMAL(), 'start')
});

const resiliencyTypeToDisplay = deepFreeze({
    REPLICATION: 'Replication',
    ERASURE_CODING: 'Erasure Coding'
});

const writableStates = deepFreeze([
    'SPILLING_BACK',
    'LOW_CAPACITY',
    'RISKY_TOLERANCE',
    'APPROUCHING_QUOTA',
    'DATA_ACTIVITY',
    'OPTIMAL'
]);

const resiliencyTypeToBlockType = deepFreeze({
    REPLICATION: 'replica',
    ERASURE_CODING: 'fragment'
});

const quotaModeToIcon = deepFreeze({
    EXCEEDING_QUOTA: _alignIconTooltip(bucketStateToIcon.EXCEEDING_QUOTA(), 'start'),
    APPROUCHING_QUOTA: _alignIconTooltip(bucketStateToIcon.APPROUCHING_QUOTA(), 'start'),
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Enabled'
    }
});

const versioningModeToText = deepFreeze({
    ENABLED: 'Enabled',
    SUSPENDED: 'Suspended',
    DISABLED: 'Disabled'
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

function _mapObjectsToFunction(statusMap) {
    return mapValues(statusMap, objOrFunc =>
        typeof objOrFunc === 'function' ? objOrFunc : () => objOrFunc
    );
}

function _alignIconTooltip(icon, align) {
    const { tooltip: text, ...rest } = icon;
    return {
        ...rest,
        tooltip: { text, align }
    };
}

export function getBucketStateIcon(bucket, align) {
    const status = bucketStateToIcon[bucket.mode](bucket);
    return isUndefined(align) ? status : _alignIconTooltip(status, align);
}

export function getPlacementTypeDisplayName(type) {
    return placementTypeToDisplayName[type];
}

export function getPlacementStateIcon(placementMode) {
    return placementModeToIcon[placementMode];
}

export function getNamespaceBucketStateIcon(bucket) {
    const { mode } = bucket;
    return namespaceBucketToStateIcon[mode];
}


export function getQuotaStateIcon(quotaMode) {
    return quotaModeToIcon[quotaMode];
}

export function getDataBreakdown(data, quota) {
    if (!quota) {
        return {
            used: data.size,
            overused: 0,
            availableForUpload: data.availableForUpload,
            potentialForUpload: 0,
            overallocated: 0
        };
    }

    const { zero, max, min } = bigInteger;
    const sizeBigInt = toBigInteger(data.size);
    const uploadBigInt = toBigInteger(data.availableForUpload);

    let q = toBigInteger(quota.size).multiply(unitsInBytes[quota.unit]);
    const used = min(sizeBigInt, q);
    const overused = sizeBigInt.subtract(used);

    q = max(q.subtract(sizeBigInt), zero);
    const availableForUpload = min(uploadBigInt, q);
    const potentialForUpload = uploadBigInt.subtract(availableForUpload);
    const overallocated = max(q.subtract(uploadBigInt), zero);

    return {
        used: fromBigInteger(used),
        overused: fromBigInteger(overused),
        availableForUpload: fromBigInteger(availableForUpload),
        potentialForUpload: fromBigInteger(potentialForUpload),
        overallocated: fromBigInteger(overallocated)
    };
}

export function getQuotaValue(quota) {
    const { size, unit } = quota;
    const quotaBigInt = toBigInteger(size).multiply(unitsInBytes[unit]);
    return fromBigInteger(quotaBigInt);
}

export function isBucketWritable(bucket) {
    return writableStates.includes(bucket.mode);
}

export function countStorageNodesByMirrorSet(placement, hostPools) {
    return flatMap(
        placement.tiers,
        tier => tier.mirrorSets.map(ms => sumBy(
            ms.resources,
            res => res.type === 'HOSTS' ?
                hostPools[res.name].storageNodeCount :
                Infinity
        ))
    );
}

export function summrizeResiliency(resiliency) {
    switch (resiliency.kind) {
        case 'REPLICATION': {
            const replicas = Math.max(resiliency.replicas, 0);
            const copies = Math.max(replicas - 1, 0);
            return {
                type: 'REPLICATION',
                mode: resiliency.mode,
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
                mode: resiliency.mode,
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

export function getResiliencyStateIcon(resiliencyMode) {
    return resiliencyModeToIcon[resiliencyMode];
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

export function getVersioningStateText(versioningMode) {
    return versioningModeToText[versioningMode];
}

export function flatPlacementPolicy(bucket) {
    return flatMap(
        bucket.placement2.tiers,
        tier => flatMap(
            tier.policyType === 'INTERNAL_STORAGE' ? [] : tier.mirrorSets,
            ms => ms.resources.map(resource => ({
                bucket: bucket.name,
                tier: tier.name,
                mirrorSet: ms.name,
                resource: resource
            }))
        )
    );
}

export function validatePlacementPolicy(policy, errors = {}) {
    const { policyType, selectedResources } = policy;

    if (policyType === 'MIRROR' && selectedResources.length === 1) {
        errors.selectedResources = 'Mirror policy requires at least 2 participating pools';

    } else if (policyType === 'SPREAD') {
        const [ first, ...others ] = selectedResources.map(res =>
            res.split(':')[0]
        );

        if (others.some(type => type !== first)) {
            errors.selectedResources = 'Configuring nodes pools combined with cloud resource as spread is not allowed';
        }
    }

    return errors;
}

export function warnPlacementPolicy(policy, hostPools, cloudResources, warnings = {}) {
    const { policyType, selectedResources } = policy;

    if (policyType === 'SPREAD') {
        const [first, ...rest] = selectedResources.map(id => {
            const [type, name] = id.split(':');
            const { region } = (type === 'HOSTS' ? hostPools : cloudResources)[name];
            return region || 'NOT_SET';
        });

        if (first && rest.some(region => region !== first)) {
            warnings.selectedResources = 'Combining resources with different assigned regions is not recommended and might raise costs';
        }
    }

    return warnings;
}
