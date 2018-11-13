/* Copyright (C) 2016 NooBaa */

import { deepFreeze, sumBy, flatMap } from './core-utils';
import { toBigInteger, fromBigInteger, bigInteger, unitsInBytes } from 'utils/size-utils';
import { stringifyAmount, pluralize } from 'utils/string-utils';
import { errorIcon, warningIcon, processIcon, healthyIcon } from 'utils/icon-utils';

const bucketStateToIcon = deepFreeze({
    NO_RESOURCES: (_, align) => errorIcon({
        text: 'No storage resources',
        align
    }),
    NOT_ENOUGH_RESOURCES: (_, align) => errorIcon({
        text: 'Not enough drives to meet resiliency policy',
        align
    }),
    NOT_ENOUGH_HEALTHY_RESOURCES: (_, align) => errorIcon({
        text:'Not enough healthy storage resources',
        align
    }),
    NO_CAPACITY: (_, align) => errorIcon({
        text: 'No potential available storage',
        align
    }),
    ALL_TIERS_HAVE_ISSUES: (_, align) => errorIcon({
        text: 'All tiers have mixed issues',
        align
    }),
    EXCEEDING_QUOTA: (_, align) => errorIcon({
        text: 'Exceeded configured quota',
        align
    }),
    TIER_NO_RESOURCES: (bucket, align) => {
        const i = _tierIndexForMode(bucket, 'NO_RESOURCES');
        return warningIcon({
            text: `Tier ${i + 1} has no storage resources`,
            align
        });
    },
    TIER_NOT_ENOUGH_RESOURCES: (bucket, align) => {
        const i = _tierIndexForMode(bucket, 'NOT_ENOUGH_RESOURCES');
        return warningIcon({
            text: `Not enough drives to meet resiliency policy in tier ${i + 1}`,
            align
        });
    },
    TIER_NOT_ENOUGH_HEALTHY_RESOURCES: (bucket, align) => {
        const i = _tierIndexForMode(bucket, 'NOT_ENOUGH_HEALTHY_RESOURCES');
        return warningIcon({
            text: `Not enough healthy storage resources in tier ${i +1}`,
            align
        });
    },
    TIER_NO_CAPACITY: (bucket, align) => {
        const i = _tierIndexForMode(bucket, 'NO_CAPACITY');
        return warningIcon({
            text: `No potential available storage in tier ${i + 1}`,
            align
        });
    },
    LOW_CAPACITY: (_, align) => warningIcon({
        text: 'Storage is low',
        align
    }),
    TIER_LOW_CAPACITY: (bucket, align) => {
        const i = _tierIndexForMode(bucket, 'LOW_CAPACITY');
        return warningIcon({
            text: `Storage is low in tier ${i + 1}`,
            align
        });
    },
    NO_RESOURCES_INTERNAL: (_, align) => warningIcon({
        text: 'No Storage Resources - Using Internal Storage',
        align
    }),
    RISKY_TOLERANCE: (_, align) => warningIcon({
        text: 'Risky failure tolerance',
        align
    }),
    APPROUCHING_QUOTA: (_, align) => warningIcon({
        text: 'Approaching configured quota',
        align
    }),
    DATA_ACTIVITY: (_, align) => processIcon({
        text: 'In Process',
        align
    }),
    OPTIMAL: (_, align) => healthyIcon({
        text: 'Healthy',
        align
    })
});

const placementModeToIcon = deepFreeze({
    NO_RESOURCES: () => errorIcon({
        text: 'No storage resources',
        align: 'start'
    }),
    NOT_ENOUGH_RESOURCES: () => errorIcon({
        text: 'Not enough drives to meet resiliency policy',
        align: 'start'
    }),
    NOT_ENOUGH_HEALTHY_RESOURCES: () => errorIcon({
        text: 'Not enough healthy storage resources',
        align: 'start'
    }),
    INTERNAL_STORAGE_ISSUES: () => errorIcon({
        text: 'Tier has no resources and the internal storage is unavailable',
        align: 'start'
    }),
    NO_CAPACITY: () => errorIcon({
        text: 'No potential available storage',
        align: 'start'
    }),
    LOW_CAPACITY: () => warningIcon({
        text: 'Storage is low',
        align: 'start'
    }),
    OPTIMAL: () => healthyIcon({
        text: 'Healthy',
        align: 'start'
    })
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
    NOT_ENOUGH_RESOURCES: () => errorIcon({
        text: 'Not enough drives to meet resiliency policy',
        align: 'start'
    }),
    POLICY_PARTIALLY_APPLIED: resiliency => {
        const resiliencyEntity = resiliency.kind === 'REPLICATION' ?
            'replicas' :
            'parity fragments';

        return warningIcon({
            text: `Bucket has no resources - no ${resiliencyEntity} will be kept while using internal storage`,
            align: 'start'
        });
    },
    RISKY_TOLERANCE: () => warningIcon({
        text: 'Risky failure tolerance',
        align: 'start'
    }),
    LOW_CAPACITY: () => warningIcon({
        text: 'Storage is low',
        align: 'start'
    }),
    OPTIMAL: () => healthyIcon({
        text: 'Healthy',
        align: 'start'
    })
});

const resiliencyTypeToDisplay = deepFreeze({
    REPLICATION: 'Replication',
    ERASURE_CODING: 'Erasure Coding'
});

const writableStates = deepFreeze([
    'OPTIMAL',
    'DATA_ACTIVITY',
    'APPROUCHING_QUOTA',
    'RISKY_TOLERANCE',
    'NO_RESOURCES_INTERNAL',
    'TIER_LOW_CAPACITY',
    'LOW_CAPACITY',
    'TIER_NO_CAPACITY',
    'TIER_NOT_ENOUGH_HEALTHY_RESOURCES',
    'TIER_NOT_ENOUGH_RESOURCES',
    'TIER_NO_RESOURCES'
]);

const resiliencyTypeToBlockType = deepFreeze({
    REPLICATION: 'replica',
    ERASURE_CODING: 'fragment'
});

const quotaModeToIcon = deepFreeze({
    EXCEEDING_QUOTA: () => errorIcon({
        text: 'Exceeded configured quota',
        align: 'start'
    }),
    APPROUCHING_QUOTA: () => warningIcon({
        text: 'Approaching configured quota',
        align: 'start'
    }),
    OPTIMAL: () => healthyIcon({
        text: 'Enabled',
        align: 'start'
    })
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

function _tierIndexForMode(bucket, mode) {
    return bucket.placement.tiers
        .findIndex(tier => tier.mode === mode);
}

export function getBucketStateIcon(bucket, align = 'center') {
    return bucketStateToIcon[bucket.mode](bucket, align);
}

export function getPlacementTypeDisplayName(type) {
    return placementTypeToDisplayName[type];
}

export function getPlacementStateIcon(tier) {
    return placementModeToIcon[tier.mode](tier);
}

export function getNamespaceBucketStateIcon(bucket) {
    const { mode } = bucket;
    return namespaceBucketToStateIcon[mode];
}

export function getQuotaStateIcon(quota) {
    return quotaModeToIcon[quota.mode](quota);
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

export function countStorageNodesByMirrorSet(tier, hostPools) {
    return (tier.mirrorSets || []).map(ms => sumBy(
        ms.resources,
        res => res.type === 'HOSTS' ?
            hostPools[res.name].storageNodeCount :
            Infinity
    ));
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

export function getResiliencyStateIcon(resiliency) {
    return resiliencyModeToIcon[resiliency.mode](resiliency);
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
        bucket.placement.tiers,
        (tier, i) => flatMap(
            tier.policyType === 'INTERNAL_STORAGE' ? [] : tier.mirrorSets,
            ms => ms.resources.map(resource => ({
                bucket: bucket.name,
                tier: tier.name,
                tierIndex: i,
                mirrorSet: ms.name,
                resource: resource
            }))
        )
    );
}

export function validatePlacementPolicy(policy, errors = {}) {
    const { policyType, selectedResources } = policy;

    if (policyType === 'MIRROR' && selectedResources.length < 2) {
        errors.selectedResources = 'Mirror policy requires at least 2 participating resources';

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
