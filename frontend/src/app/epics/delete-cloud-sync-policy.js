/* Copyright (C) 2018 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { DELETE_CLOUD_SYNC_POLICY } from 'action-types';
import { completeDeleteCloudSyncPolicy, failDeleteCloudSyncPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_CLOUD_SYNC_POLICY)
        .flatMap(async action => {
            const { bucketName } = action.payload;

            try {
                await  api.bucket.delete_cloud_sync({ name: bucketName });

                return completeDeleteCloudSyncPolicy(bucketName);

            } catch (error) {
                return failDeleteCloudSyncPolicy(
                    bucketName,
                    mapErrorObject(error)
                );
            }
        });
}
