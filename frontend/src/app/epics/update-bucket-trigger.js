/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_TRIGGER } from 'action-types';
import { completeUpdateBucketTrigger, failUpdateBucketTrigger } from 'action-creators';


export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_TRIGGER)
        .flatMap(async action => {
            const { bucketName, triggerId, config } = action.payload;

            try {
                await api.bucket.update_bucket_lambda_trigger({
                    bucket_name: bucketName,
                    id: triggerId,
                    event_name: config.event,
                    func_name: config.funcName,
                    func_version: config.funcVersion,
                    object_prefix: config.prefix,
                    object_suffix: config.suffix,
                    enabled: config.enabled
                });

                return completeUpdateBucketTrigger(bucketName);

            } catch (error) {
                return failUpdateBucketTrigger(
                    bucketName,
                    mapErrorObject(error)
                );
            }
        });
}
