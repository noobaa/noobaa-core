/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPDATE_BUCKET_SPILLOVER_POLICY } from 'action-types';
import { completeUpdateBucketSpilloverPolicy, failUpdateBucketSpilloverPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_SPILLOVER_POLICY),
        mergeMap(async action => {
            const { bucket, resource } = action.payload;

            try {
                await api.bucket.update_bucket({
                    name: bucket,
                    spillover: resource
                });
                return completeUpdateBucketSpilloverPolicy(bucket);
            } catch (error) {
                return failUpdateBucketSpilloverPolicy(bucket, error);
            }
        })
    );
}
