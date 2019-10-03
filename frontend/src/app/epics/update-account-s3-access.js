/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_ACCOUNT_S3_ACCESS } from 'action-types';
import { completeUpdateAccountS3Access, failUpdateAccountS3Access } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_ACCOUNT_S3_ACCESS),
        mergeMap(async action => {
            const {
                accountName,
                defaultResource,
                hasAccessToAllBuckets,
                allowedBuckets,
                allowBucketCreation
            } = action.payload;

            try {
                await api.account.update_account_s3_access({
                    email: accountName,
                    s3_access: true,
                    default_pool: defaultResource,
                    allowed_buckets: {
                        full_permission: hasAccessToAllBuckets,
                        permission_list: hasAccessToAllBuckets ? undefined : allowedBuckets
                    },
                    allow_bucket_creation: allowBucketCreation
                });

                return completeUpdateAccountS3Access(accountName);

            } catch (error) {
                return failUpdateAccountS3Access(
                    accountName,
                    mapErrorObject(error)
                );
            }
        })
    );
}
