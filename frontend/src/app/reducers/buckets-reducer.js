/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
import { groupBy, flatMap } from 'utils/core-utils';


// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const { buckets, tiers, pools } = payload;

    return keyByProperty(buckets, 'name', bucket => {
        const {
            name,
            mode,
            storage,
            data,
            quota,
            num_objects,
            cloud_sync,
            demo_bucket,
            tiering,
            usage_by_pool
        } = bucket;

        const usageByResource = keyByProperty(
            usage_by_pool.pools,
            'pool_name',
            resource => resource.storage
        );

        const resourceTypeByResource = keyByProperty(
            pools,
            'name',
            resource => resource.resource_type
        );

        const usedReosurces = flatMap(
            tiering.tiers,
            ref => {
                const tier = tiers.find(tier => tier.name === ref.tier);

                return tier.attached_pools.map(
                    name => {
                        return {
                            name,
                            type: resourceTypeByResource[name],
                            used: usageByResource[name] ? usageByResource[name].blocks_size : 0,
                            spillover: ref.spillover,
                            disabled: ref.disabled
                        };
                    }
                );
            }
        );

        const { true: spilloverResources = [], false: storageResources = [] } =
            groupBy(usedReosurces, resource => resource.spillover);

        const rootTier = tiers.find(
            tier => tier.name === tiering.tiers[0].tier
        );

        return {
            name,
            mode,
            storage,
            data,
            quota,
            objectsCount: num_objects,
            cloudSyncStatus: (cloud_sync && cloud_sync.status) || 'NOTSET',
            demoBucket: demo_bucket,
            backingResources: {
                type: rootTier.data_placement,
                resources: storageResources,
                spillover: spilloverResources
            }
        };
    });
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
