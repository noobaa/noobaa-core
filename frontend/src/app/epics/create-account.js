/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { sleep, all } from 'utils/promise-utils';
import { CREATE_ACCOUNT } from 'action-types';
import { completeCreateAccount, failCreateAccount } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_ACCOUNT),
        mergeMap(async action => {
            const {
                accountName,
                isAdmin,
                password,
                defaultResource,
                hasAccessToAllBucekts,
                allowedBuckets,
                allowBucketCreation
            } = action.payload;

            try {
                await all(
                    api.account.create_account({
                        name: accountName.split('@')[0],
                        email: accountName,
                        has_login: isAdmin,
                        password: isAdmin ? password : undefined,
                        must_change_password: isAdmin || undefined,
                        s3_access: true,
                        default_pool: defaultResource,
                        allowed_buckets: {
                            full_permission: hasAccessToAllBucekts,
                            permission_list: !hasAccessToAllBucekts ? allowedBuckets : undefined
                        },
                        allow_bucket_creation: allowBucketCreation
                    }),
                    sleep(750)
                );

                return completeCreateAccount(accountName, password);

            } catch (error) {
                return failCreateAccount(
                    accountName,
                    mapErrorObject(error)
                );
            }
        })
    );
}
