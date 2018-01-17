/* Copyright (C) 2018 NooBaa */

import { TOGGLE_CLOUD_SYNC_POLICY } from 'action-types';
import { completeToggleCloudSyncPolicy, failToggleCloudSyncPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(TOGGLE_CLOUD_SYNC_POLICY)
        .flatMap(async action => {
            const { bucket, paused } = action.payload;

            try {
                await  api.bucket.toggle_cloud_sync({
                    name: bucket,
                    pause: paused
                });

                return completeToggleCloudSyncPolicy(bucket, paused);
            } catch (error) {
                return failToggleCloudSyncPolicy(bucket, paused, error);
            }
        });
}
