/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(_, { payload }) {
    const { pools, buckets, tiers } = payload;

    const bucketsByPools = _mapPoolsToBuckets(buckets, tiers);

    return keyByProperty(
        pools.filter(pool => pool.resource_type === 'CLOUD'),
        'name',
        res => _mapResource(res, bucketsByPools)
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapResource(resource, bucketsByPools) {
    const {
        name,
        mode,
        cloud_info,
        region,
        storage,
        undeletable,
        create_time,
        io_stats
    } = resource;

    return {
        name,
        mode,
        region,
        type: cloud_info.endpoint_type,
        endpoint: cloud_info.endpoint,
        target: cloud_info.target_bucket,
        storage: mapApiStorage(storage),
        usedBy: bucketsByPools[name] || [],
        associatedAccounts: resource.associated_accounts || [],
        createdBy: cloud_info.created_by,
        creationTime: create_time,
        internalHost: `${name}#internal-host`,
        io: _mapIO(io_stats),
        undeletable
    };
}

function _mapTiersToBuckets(buckets) {
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
    const bucketsByTierName = _mapTiersToBuckets(buckets);
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

function _mapIO(stats) {
    return {
        readCount: stats.read_count,
        readSize: stats.read_bytes,
        writeCount: stats.write_count,
        writeSize: stats.write_bytes
    };
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
