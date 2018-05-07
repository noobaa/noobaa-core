/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_PLACEMENT_POLICY } from 'action-types';
import { completeUpdateBucketPlacementPolicy, failUpdateBucketPlacementPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_PLACEMENT_POLICY),
        mergeMap(async action => {
            const { bucket, tier, policyType, resources } = action.payload;

            try {
                await api.tier.update_tier({
                    name: tier,
                    data_placement: policyType,
                    attached_pools: resources
                });

                return completeUpdateBucketPlacementPolicy(bucket);

            } catch (error) {
                return failUpdateBucketPlacementPolicy(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}

