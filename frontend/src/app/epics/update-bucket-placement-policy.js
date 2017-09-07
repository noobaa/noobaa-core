/* Copyright (C) 2016 NooBaa */

import { UPDATE_BUCKET_PLACEMENT_POLICY } from 'action-types';
import { completeUpdateBucketPlacementPolicy, failUpdateBucketPlacementPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_PLACEMENT_POLICY)
        .flatMap(async action => {
            const { bucket, tier, policyType, resources } = action.payload;

            try {
                await api.tier.update_tier({
                    name: tier,
                    data_placement: policyType,
                    attached_pools: resources
                });

                return completeUpdateBucketPlacementPolicy(bucket);

            } catch (error) {
                return failUpdateBucketPlacementPolicy(bucket, error);
            }
        });
}

