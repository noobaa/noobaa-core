/* Copyright (C) 2018 NooBaa */

import { DELETE_CLOUD_SYNC_POLICY } from 'action-types';
import { completeDeleteCloudSyncPolicy, failDeleteCloudSyncPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_CLOUD_SYNC_POLICY)
        .flatMap(async action => {
            const { bucket } = action.payload;

            try {
                await  api.bucket.delete_cloud_sync({ name: bucket });

                return completeDeleteCloudSyncPolicy(bucket);
            } catch (error) {
                return failDeleteCloudSyncPolicy(bucket, error);
            }
        });
}
