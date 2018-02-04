/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { TOGGLE_BUCKET_SPILLOVER } from 'action-types';
import { completeToggleBucketSpillover, failToggleBucketSpillover } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(TOGGLE_BUCKET_SPILLOVER)
        .flatMap(async action => {
            const { bucket, state } = action.payload;

            try {
                await api.bucket.update_bucket({
                    name: bucket,
                    use_internal_spillover: state
                });
                return completeToggleBucketSpillover(bucket, state);

            } catch (error) {
                return failToggleBucketSpillover(
                    bucket,
                    state,
                    mapErrorObject(error)
                );
            }
        });
}
