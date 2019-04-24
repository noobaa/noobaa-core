/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { ADD_BUCKET_TRIGGER } from 'action-types';
import { completeAddBucketTrigger, failAddBucketTrigger } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ADD_BUCKET_TRIGGER),
        mergeMap(async action => {
            const {
                bucket,
                funcName,
                funcVersion,
                event,
                prefix,
                suffix,
                enabled
            } = action.payload;

            try {
                await api.bucket.add_bucket_lambda_trigger({
                    bucket_name: bucket,
                    func_name: funcName,
                    func_version: funcVersion,
                    event_name: event,
                    object_prefix: prefix,
                    object_suffix: suffix,
                    enabled: enabled
                });

                return completeAddBucketTrigger(bucket);

            } catch (error) {
                return failAddBucketTrigger(
                    bucket,
                    mapErrorObject(error)
                );
            }
        })
    );
}
