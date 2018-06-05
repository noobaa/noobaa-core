/* Copyright (C) 2016 NooBaa */

import { keyByProperty, groupBy, compare } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
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

    const tiers = keyByProperty(payload.tiers, 'name');
    const resTypeByName = keyByProperty(payload.pools, 'name', res => res.resource_type);

    return keyByProperty(
        dataBuckets,
        'name',
        bucket => _mapBucket(bucket, tiers, resTypeByName)
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapBucket(bucket, tiersByName, resTypeByName) {
    const enabledTiers = bucket.tiering.tiers
        .filter(record => !record.disabled);

    const resUsageByName = keyByProperty(
        bucket.usage_by_pool.pools,
        'pool_name',
        record => record.storage.blocks_size
    );

    const { placementTiers = [], spilloverTiers = [] } = groupBy(
        enabledTiers,
        record => record.spillover ? 'spilloverTiers' : 'placementTiers',
        record => tiersByName[record.tier]
    );

    const { storage, data, quota, stats, triggers, policy_modes } = bucket;
    const { placement_status, resiliency_status, spillover_status, quota_status } = policy_modes;
    return {
        name: bucket.name,
        tierName: placementTiers[0].name,
        mode: bucket.mode,
        storage: mapApiStorage(storage.values, storage.last_update),
        data: _mapData(data),
        quota: _mapQuota(quota_status, quota),
        objectCount: bucket.num_objects,
        undeletable: bucket.undeletable,
        placement: _mapPlacement(placement_status, placementTiers[0], resTypeByName, resUsageByName),
        resiliency: _mapResiliency(resiliency_status, placementTiers[0]),
        spillover: _mapSpillover(spillover_status, spilloverTiers[0], resTypeByName, resUsageByName),
        failureTolerance: _mapFailureTolerance(bucket),
        versioning: _mapVersioning(bucket),
        io: _mapIO(stats),
        triggers: _mapTriggers(triggers)
    };
}

function _mapData(data){
    return {
        lastUpdate: data.last_update,
        size: data.size,
        sizeReduced: data.size_reduced,
        availableForUpload: data.free,
        availableForSpillover: data.spillover_free
    };
}

function _mapQuota(mode, quota) {
    if (!quota) {
        return;
    }

    const { size, unit } = quota;
    return { mode, size, unit };
}

function _mapPlacement(mode, tier, typeByName, usageByName) {
    const { data_placement: policyType, mirror_groups } = tier;
    const mirrorSets = mirror_groups
        .sort((group1, group2) => compare(group1.name, group2.name))
        .map(group => {
            const { name, pools } = group;
            const resources = pools
                .map(name => {
                    const type = typeByName[name];
                    const usage = usageByName[name] || 0;
                    return { type, name, usage };
                });

            return { name, resources };
        });

    return { mode, policyType, mirrorSets };
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

function _mapSpillover(mode, tier, typeByName, usageByName) {
    if (!tier) return;
    const { name: mirrorSet, pools } = tier.mirror_groups[0];
    const [name] = pools;
    const type = typeByName[name];
    const usage = usageByName[name] || 0;
    return { type, name, mode, mirrorSet, usage };
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

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
