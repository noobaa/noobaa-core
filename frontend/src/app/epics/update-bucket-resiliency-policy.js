/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_RESILIENCY_POLICY } from 'action-types';
import { completeUpdateBucketResiliencyPolicy, failUpdateBucketResiliencyPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_RESILIENCY_POLICY),
        mergeMap(async action => {
            const { bucket, policy } = action.payload;
            const { replicas, dataFrags: data_frags, parityFrags: parity_frags } = policy;

            try {
                await api.tiering_policy.update_chunk_config_for_bucket({
                    bucket_name: bucket,
                    chunk_coder_config: { replicas, data_frags, parity_frags }
                });

                return completeUpdateBucketResiliencyPolicy(bucket);

            } catch (error) {
                return failUpdateBucketResiliencyPolicy(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}

