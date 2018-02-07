/* Copyright (C) 2016 NooBaa */

import { UPDATE_BUCKET_SPILLOVER } from 'action-types';
import { completeUpdateBucketSpillover, failUpdateBucketSpillover } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_SPILLOVER)
        .flatMap(async action => {
            const { bucket, resource } = action.payload;

            try {
                await api.bucket.update_bucket({
                    name: bucket,
                    spillover: resource
                });
                return completeUpdateBucketSpillover(bucket);
            } catch (error) {
                return failUpdateBucketSpillover(bucket, error);
            }
        });
}
