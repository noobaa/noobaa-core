/* Copyright (C) 2016 NooBaa */

import { UPDATE_BUCKETS_SPILLOVER } from 'action-types';
import { completeUpdateBucketsSpillover, failUpdateBucketsSpillover } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKETS_SPILLOVER)
        .flatMap(async action => {
            const buckets = action.payload.buckets.map(bucket => ({
                name: bucket.name,
                use_internal_spillover: bucket.spilloverEnabled
            }));

            try {
                await api.bucket.update_buckets(buckets);
                return completeUpdateBucketsSpillover(buckets);

            } catch (error) {
                return failUpdateBucketsSpillover(buckets, error);
            }
        });
}
