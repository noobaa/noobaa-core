/* Copyright (C) 2016 NooBaa */

import { DELETE_BUCKET } from 'action-types';
import { completeDeleteBucket, failDeleteBucket } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_BUCKET)
        .flatMap(async action => {
            const { bucket } = action.payload;
            try {
                await api.bucket.delete_bucket({ name: bucket });
                return completeDeleteBucket(bucket);

            } catch (error) {
                return failDeleteBucket(bucket, error);
            }
        });
}
