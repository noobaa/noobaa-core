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
                hasS3Access,
                defaultResource,
                hasAccessToAllBuckets,
                allowedBuckets
            } = action.payload;

            try {
                await api.account.update_account_s3_access({
                    email: accountName,
                    s3_access: hasS3Access,
                    default_pool: !hasS3Access ? undefined : defaultResource,
                    allowed_buckets: !hasS3Access ? undefined : {
                        full_permission: hasAccessToAllBuckets,
                        permission_list: hasAccessToAllBuckets ? undefined : allowedBuckets
                    }
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
