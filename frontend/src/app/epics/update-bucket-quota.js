/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { UPDATE_BUCKET_QUOTA } from 'action-types';
import { completeUpdateBucketQuota, failUpdateBucketQuota } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(UPDATE_BUCKET_QUOTA)
        .flatMap(async action => {
            const { bucket, quota } = action.payload;

            try {
                await api.bucket.update_bucket({ name: bucket, quota });
                return completeUpdateBucketQuota(bucket);

            } catch (error) {
                return failUpdateBucketQuota(bucket, error);
            }
        });
}
