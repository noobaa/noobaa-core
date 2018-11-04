/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { ADD_BUCKET_TIER } from 'action-types';
import { completeAddBucketTier, failAddBucketTier } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ADD_BUCKET_TIER),
        mergeMap(async action => {
            const { bucket, policyType, resourceIds } = action.payload;
            const resourceNames = resourceIds.map(res => res.split(':')[1]);

            try {
                await api.tiering_policy.add_tier_to_bucket({
                    bucket_name: bucket,
                    tier: {
                        data_placement: policyType,
                        attached_pools: resourceNames
                    }
                });

                return completeAddBucketTier(bucket);

            } catch (error) {
                return failAddBucketTier(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}

