/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_VERSIONING_POLICY } from 'action-types';
import { completeUpdateBucketVersioningPolicy, failUpdateBucketVersioningPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_VERSIONING_POLICY),
        mergeMap(async action => {
            const { bucket, versioning } = action.payload;

            try {
                await api.bucket.update_bucket({ name: bucket, versioning });
                return completeUpdateBucketVersioningPolicy(bucket, versioning);

            } catch (error) {
                return failUpdateBucketVersioningPolicy(
                    bucket,
                    versioning,
                    mapErrorObject(error)
                );
            }
        })
    );
}
