/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { REMOVE_BUCKET_TRIGGER } from 'action-types';
import { completeRemoveBucketTrigger, failRemoveBucketTrigger } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(REMOVE_BUCKET_TRIGGER),
        mergeMap(async action => {
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
        })
    );
}
