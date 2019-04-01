/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_TRIGGER } from 'action-types';
import { completeUpdateBucketTrigger, failUpdateBucketTrigger } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_TRIGGER),
        mergeMap(async action => {
            const { bucketName, triggerId, config, displayEntity } = action.payload;

            try {
                if (bucketName !== config.bucketName) {
                    await api.bucket.delete_bucket_lambda_trigger({
                        bucket_name: bucketName,
                        id: triggerId
                    });
                    await api.bucket.add_bucket_lambda_trigger({
                        bucket_name: config.bucketName,
                        event_name: config.event,
                        func_name: config.funcName,
                        func_version: config.funcVersion,
                        object_prefix: config.prefix,
                        object_suffix: config.suffix,
                        enabled: config.enabled
                    });
                } else {
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
                }
                
                return completeUpdateBucketTrigger(displayEntity);

            } catch (error) {
                return failUpdateBucketTrigger(
                    displayEntity,
                    mapErrorObject(error)
                );
            }
        })
    );
}
