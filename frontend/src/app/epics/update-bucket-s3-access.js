/* Copyright (C) 2016 NooBaa */

import { UPDATE_BUCKET_S3_ACCESS } from 'action-types';
import { completeUpdateBucketS3Access, failUpdateBucketS3Access } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_BUCKET_S3_ACCESS)
        .flatMap(async action => {
            const { bucketName, allowedAccounts } = action.payload;

            try {
                await api.bucket.update_bucket_s3_access({
                    name: bucketName,
                    allowed_accounts: allowedAccounts
                });

                return completeUpdateBucketS3Access(bucketName);

            } catch (error) {
                return failUpdateBucketS3Access(bucketName, error);
            }
        });
}
