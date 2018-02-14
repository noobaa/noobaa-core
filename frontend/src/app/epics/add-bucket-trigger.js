/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { ADD_BUCKET_TRIGGER } from 'action-types';
import { completeAddBucketTrigger, failAddBucketTrigger } from 'action-creators';


export default function(action$, { api }) {
    return action$
        .ofType(ADD_BUCKET_TRIGGER)
        .flatMap(async action => {
            const { bucketName, config } = action.payload;

            try {
                await api.bucket.add_bucket_lambda_trigger({
                    bucket_name: bucketName,
                    event_name: config.event,
                    func_name: config.funcName,
                    func_version: config.funcVersion,
                    object_prefix: config.prefix,
                    object_suffix: config.suffix,
                    enabled: config.enabled
                });

                return completeAddBucketTrigger(bucketName);

            } catch (error) {
                return failAddBucketTrigger(
                    bucketName,
                    mapErrorObject(error)
                );
            }
        });
}
