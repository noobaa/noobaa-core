/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { RESET_ACCOUNT_PASSWORD } from 'action-types';
import { completeResetAccountPassword, failResetAccountPassword } from 'action-creators';
import { all, sleep } from 'utils/promise-utils';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(RESET_ACCOUNT_PASSWORD),
        mergeMap(async action => {
            const {
                verificationPassword,
                accountName,
                password
            } = action.payload;

            try {
                await all(
                    api.account.reset_password({
                        verification_password: verificationPassword,
                        email: accountName,
                        password: password,
                        must_change_password: true
                    }),
                    sleep(750)
                );

                return completeResetAccountPassword(accountName, password);

            } catch (error) {
                return failResetAccountPassword(
                    accountName,
                    mapErrorObject(error)
                );
            }
        })
    );
}

