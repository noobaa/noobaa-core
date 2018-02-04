/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_QUOTA } from 'action-types';
import { completeUpdateBucketQuota, failUpdateBucketQuota } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_QUOTA)
        .flatMap(async action => {
            const { bucket, quota } = action.payload;

            try {
                await api.bucket.update_bucket({ name: bucket, quota });
                return completeUpdateBucketQuota(bucket);

            } catch (error) {
                return failUpdateBucketQuota(
                    bucket,
                    mapErrorObject(error)
                );
            }
        });
}
