/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_BUCKET_S3_ACCESS } from 'action-types';
import { completeUpdateBucketS3Access, failUpdateBucketS3Access } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_BUCKET_S3_ACCESS),
        mergeMap(async action => {
            const { bucketName, allowedAccounts } = action.payload;

            try {
                await api.bucket.update_bucket_s3_access({
                    name: bucketName,
                    allowed_accounts: allowedAccounts
                });

                return completeUpdateBucketS3Access(bucketName);

            } catch (error) {
                return failUpdateBucketS3Access(
                    bucketName,
                    mapErrorObject(error)
                );
            }
        })
    );
}
