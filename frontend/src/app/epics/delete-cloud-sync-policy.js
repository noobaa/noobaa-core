/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_CLOUD_SYNC_POLICY } from 'action-types';
import { completeDeleteCloudSyncPolicy, failDeleteCloudSyncPolicy } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_CLOUD_SYNC_POLICY),
        mergeMap(async action => {
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
        })
    );
}
