/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_TIER_PLACEMENT_POLICY } from 'action-types';
import { completeUpdateTierPlacementPolicy, failUpdateTierPlacementPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_TIER_PLACEMENT_POLICY),
        mergeMap(async action => {
            const { bucket, tier, policyType, resourceIds } = action.payload;
            const resourceNames = resourceIds.map(res => res.split(':')[1]);

            try {
                await api.tier.update_tier({
                    name: tier,
                    data_placement: policyType,
                    attached_pools: resourceNames
                });

                return completeUpdateTierPlacementPolicy(bucket, tier);

            } catch (error) {
                console.warn('HEREEREREREr', error);
                return failUpdateTierPlacementPolicy(
                    bucket,
                    tier,
                    mapErrorObject(error)
                );
            }
        })
    );
}

