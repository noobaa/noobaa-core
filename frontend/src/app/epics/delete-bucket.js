/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_BUCKET } from 'action-types';
import { completeDeleteBucket, failDeleteBucket } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_BUCKET),
        mergeMap(async action => {
            const { bucket } = action.payload;
            try {
                await api.bucket.delete_bucket({ name: bucket });
                return completeDeleteBucket(bucket);

            } catch (error) {
                return failDeleteBucket(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}
