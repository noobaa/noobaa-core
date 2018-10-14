/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, groupBy, compare, pick } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { getResourceId } from 'utils/resource-utils';
import { mapApiStorage } from 'utils/state-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const dataBuckets = payload.buckets
        .filter(bucket => bucket.bucket_type === 'REGULAR');

    const tiersByName = keyByProperty(payload.tiers, 'name');
    const resTypeByName = keyByProperty(payload.pools, 'name', res => res.resource_type);

    return keyByProperty(
        dataBuckets,
        'name',
        bucket => _mapBucket(bucket, tiersByName, resTypeByName)
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapBucket(bucket, tiersByName, resTypeByName) {
    const placementTiers = bucket.tiering.tiers
        .filter(record => !record.disabled)
        .sort((r1, r2) => compare(r1.order, r2.order))
        .map(record => tiersByName[record.tier]);

    const { storage, data, quota, stats, triggers, policy_modes, stats_by_type = [] } = bucket;
    const { placement_status, resiliency_status, quota_status } = policy_modes;
    return {
        name: bucket.name,
        tierName: placementTiers[0].name,
        mode: bucket.mode,
        storage: mapApiStorage(storage.values, storage.last_update),
        data: _mapData(data),
        quota: _mapQuota(quota_status, quota),
        objectCount: bucket.num_objects,
        undeletable: bucket.undeletable,
        placement: _mapPlacement(placement_status, placementTiers[0], resTypeByName),
        placement2: _mapPlacement2(placementTiers, resTypeByName),
        resiliency: _mapResiliency(resiliency_status, placementTiers[0]),
        failureTolerance: _mapFailureTolerance(bucket),
        versioning: _mapVersioning(bucket),
        io: _mapIO(stats),
        triggers: _mapTriggers(triggers),
        usageDistribution: _mapUsageDistribution(bucket, resTypeByName),
        statsByDataType: keyByProperty(
            stats_by_type,
            'data_type',
            record => pick(record, ['reads', 'writes', 'count', 'size'])
        )
    };
}

function _mapData(data){
    return {
        lastUpdate: data.last_update,
        size: data.size,
        sizeReduced: data.size_reduced,
        availableForUpload: data.free
    };
}

function _mapQuota(mode, quota) {
    if (!quota) {
        return;
    }

    const { size, unit } = quota;
    return { mode, size, unit };
}

function _mapPlacement(mode, tier, typeByName) {
    const { data_placement: policyType, mirror_groups } = tier;
    const usingInternal =
        (tier.mirror_groups.length === 1) &&
        (tier.mirror_groups[0].pools.length === 1) &&
        (typeByName[tier.mirror_groups[0].pools[0]] === 'INTERNAL');

    if (usingInternal) {
        return { mode: 'OPTIMAL', policyType, mirrorSets: [] };

    } else {
        const mirrorSets = mirror_groups
            .sort((group1, group2) => compare(group1.name, group2.name))
            .map(group => {
                const { name, pools } = group;
                const resources = pools
                    .map(name => {
                        const type = typeByName[name];
                        return { type, name };
                    });

                return { name, resources };
            });

        return { mode, policyType, mirrorSets };
    }
}

function _mapPlacement2(tiers, typeByName) {
    const usingInternal =
        (tiers.length === 1) &&
        (tiers[0].mirror_groups.length === 1) &&
        (tiers[0].mirror_groups[0].pools.length === 1) &&
        (typeByName[tiers[0].mirror_groups[0].pools[0]] === 'INTERNAL');

    if (usingInternal) {
        return {
            mode: 'OPTIMAL',
            tiers: [{
                name: tiers[0].name,
                mode: 'OPTIMAL', // TODO
                policyType: 'INTERNAL_STORAGE'
            }]
        };

    } else {
        return {
            mode: 'OPTIMAL',
            tiers: tiers.map(tier => {
                const { name, data_placement: policyType, mirror_groups } = tier;
                const mode = 'OPTIMAL'; // TODO
                const mirrorSets = mirror_groups
                    .sort((g1, g2) => compare(g1.name, g2.name))
                    .map(group => {
                        const { name, pools } = group;
                        const resources = pools.map(name => {
                            const type = typeByName[name];
                            return { type, name };
                        });

                        return { name, resources };
                    });

                return { name, mode, policyType, mirrorSets };
            })
        };
    }
}

function _mapResiliency(mode, tier) {
    const { data_frags, parity_frags, replicas } = tier.chunk_coder_config;

    if (parity_frags) {
        return {
            kind: 'ERASURE_CODING',
            mode: mode,
            dataFrags: data_frags,
            parityFrags: parity_frags
        };
    } else {
        return {
            kind: 'REPLICATION',
            mode: mode,
            replicas: replicas
        };
    }
}

function _mapFailureTolerance(bucket) {
    const { host_tolerance: hosts, node_tolerance: nodes } = bucket;
    return { hosts, nodes };
}


function _mapIO(stats = {}) {
    const { reads = 0, writes = 0, last_read = -1, last_write = -1 } = stats;
    return {
        readCount: reads ,
        lastRead: last_read,
        writeCount: writes,
        lastWrite: last_write
    };
}

function _calcTriggerMode(trigger) {
    if (!trigger.enabled) {
        return 'DISABLED';
    }

    if (trigger.permission_problem) {
        return 'MISSING_PERMISSIONS';
    }

    return 'OPTIMAL';
}

function _mapTriggers(triggers) {
    return keyByProperty(
        triggers,
        'id',
        trigger => ({
            id: trigger.id,
            mode: _calcTriggerMode(trigger),
            event: trigger.event_name,
            func: {
                name: trigger.func_name,
                version: trigger.func_version
            },
            prefix: trigger.object_prefix || '',
            suffix: trigger.object_suffix || '',
            lastRun: trigger.last_run
        })
    );
}

function _mapVersioning(bucket) {
    const { versioning: mode } = bucket;
    return { mode };
}

function _mapUsageDistribution(bucket, resTypeByName) {
    const { last_update, pools } = bucket.usage_by_pool;
    return {
        lastUpdate: last_update,
        resources: keyBy(
            pools,
            record => {
                const name = record.pool_name;
                return getResourceId(resTypeByName[name], name);
            },
            record => record.storage.blocks_size
        )
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
