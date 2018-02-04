/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_RESILIENCY_POLICY } from 'action-types';
import { completeUpdateBucketResiliencyPolicy, failUpdateBucketResiliencyPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_RESILIENCY_POLICY)
        .flatMap(async action => {
            const { bucket, tier, policy } = action.payload;
            const { replicas, dataFrags: data_frags, parityFrags: parity_frags } = policy;

            try {
                await api.tier.update_tier({
                    name: tier,
                    chunk_coder_config: { replicas, data_frags, parity_frags }
                });

                return completeUpdateBucketResiliencyPolicy(bucket);

            } catch (error) {
                return failUpdateBucketResiliencyPolicy(
                    bucket,
                    mapErrorObject(error)
                );
            }
        });
}

