/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
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
    const { pools, buckets, tiers } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    const bucketMapping = _mapPoolsToBuckets(buckets, tiers);
    return keyByProperty(nodePools, 'name', pool => _mapPool(pool, bucketMapping));
}

// ------------------------------
// Local util functions
// ------------------------------

function _mapTiersToBucket(buckets) {
    const dataBuckets = buckets
        .filter(bucket => bucket.bucket_type === 'REGULAR');

    const pairs = flatMap(
        dataBuckets,
        bucket => bucket.tiering.tiers
            .map(item => {
                const bucketName = bucket.name;
                const tierName = item.tier;
                return { bucketName, tierName };
            })
    );

    return keyBy(
        pairs,
        pair => pair.tierName,
        pair => pair.bucketName
    );
}

function _mapPoolsToBuckets(buckets, tiers) {
    const bucketsByTierName = _mapTiersToBucket(buckets);
    const pairs = flatMap(
        tiers.filter(tier => Boolean(bucketsByTierName[tier.name])),
        tier => flatMap(
            tier.mirror_groups,
            mirrorGroup => mirrorGroup.pools.map(
                poolName => ({
                    bucket: bucketsByTierName[tier.name],
                    pool: poolName
                })
            )
        )
    );

    return groupBy(
        pairs,
        pair => pair.pool,
        pair => pair.bucket
    );
}

function _mapPool(pool, bucketMapping) {
    const activityList = (pool.data_activities.activities || [])
        .map(activity => ({
            kind: activity.reason,
            nodeCount: activity.count,
            progress: activity.progress,
            eta: activity.time.end
        }));

    return {
        name: pool.name,
        mode: pool.mode,
        storage: mapApiStorage(pool.storage),
        associatedAccounts: pool.associated_accounts,
        connectedBuckets: bucketMapping[pool.name] || [],
        hostCount: pool.hosts.count,
        hostsByMode: pool.hosts.by_mode,
        storageNodeCount: pool.storage_nodes.count,
        storageNodesByMode: pool.storage_nodes.by_mode,
        endpointNodeCount: 0, // pool.s3_nodes.count
        endpointNodesByMode: {}, // pool.s3_nodes.by_mode
        undeletable: pool.undeletable,
        activities: {
            hostCount: pool.data_activities.host_count,
            list: activityList
        }
    };
}
// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
