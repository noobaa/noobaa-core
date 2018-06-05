/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_QUOTA_POLICY } from 'action-types';
import { completeUpdateBucketQuotaPolicy, failUpdateBucketQuotaPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_QUOTA_POLICY),
        mergeMap(async action => {
            const { bucket, quota } = action.payload;

            try {
                await api.bucket.update_bucket({ name: bucket, quota });
                return completeUpdateBucketQuotaPolicy(bucket);

            } catch (error) {
                return failUpdateBucketQuotaPolicy(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}
