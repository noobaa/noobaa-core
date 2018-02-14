/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { REMOVE_BUCKET_TRIGGER } from 'action-types';
import { completeRemoveBucketTrigger, failRemoveBucketTrigger } from 'action-creators';


export default function(action$, { api }) {
    return action$
        .ofType(REMOVE_BUCKET_TRIGGER)
        .flatMap(async action => {
            const { bucketName, triggerId } = action.payload;

            try {
                await api.bucket.delete_bucket_lambda_trigger({
                    bucket_name: bucketName,
                    id: triggerId
                });

                return completeRemoveBucketTrigger(bucketName);

            } catch (error) {
                return failRemoveBucketTrigger(
                    bucketName,
                    mapErrorObject(error)
                );
            }
        });
}
