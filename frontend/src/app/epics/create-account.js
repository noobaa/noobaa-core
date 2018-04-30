/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { sleep, all } from 'utils/promise-utils';
import { CREATE_ACCOUNT } from 'action-types';
import { completeCreateAccount, failCreateAccount } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(CREATE_ACCOUNT)
        .flatMap(async action => {
            const {
                accountName,
                hasLoginAccess,
                password,
                hasS3Access,
                defaultResource,
                hasAccessToAllBucekts,
                allowedBuckets
            } = action.payload;

            try {
                await all(
                    api.account.create_account({
                        name: accountName.split('@')[0],
                        email: accountName,
                        has_login: hasLoginAccess,
                        password: hasLoginAccess ? password : undefined,
                        must_change_password: hasLoginAccess || undefined,
                        s3_access: hasS3Access,
                        default_pool: hasS3Access ? defaultResource : undefined,
                        allowed_buckets: hasS3Access ? {
                            full_permission: hasAccessToAllBucekts,
                            permission_list: !hasAccessToAllBucekts ? allowedBuckets : undefined
                        } : undefined
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
        });
}
