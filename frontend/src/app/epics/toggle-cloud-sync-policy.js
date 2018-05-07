/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { TOGGLE_CLOUD_SYNC_POLICY } from 'action-types';
import { completeToggleCloudSyncPolicy, failToggleCloudSyncPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(TOGGLE_CLOUD_SYNC_POLICY),
        mergeMap(async action => {
            const { bucketName, paused } = action.payload;

            try {
                await  api.bucket.toggle_cloud_sync({
                    name: bucketName,
                    pause: paused
                });

                return completeToggleCloudSyncPolicy(bucketName, paused);

            } catch (error) {
                return failToggleCloudSyncPolicy(
                    bucketName,
                    paused,
                    mapErrorObject(error)
                );
            }
        })
    );
}
