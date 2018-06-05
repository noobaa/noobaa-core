/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { REGENERATE_ACCOUNT_CREDENTIALS } from 'action-types';
import {
    completeRegenerateAccountCredentials,
    failRegenerateAccountCredentials
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(REGENERATE_ACCOUNT_CREDENTIALS),
        mergeMap(async action => {
            const { accountName, verificationPassword } = action.payload;

            try {
                await  api.account.generate_account_keys({
                    email: accountName,
                    verification_password: verificationPassword
                });

                return completeRegenerateAccountCredentials(accountName);

            } catch (error) {
                return failRegenerateAccountCredentials(
                    accountName,
                    mapErrorObject(error)
                );
            }
        })
    );
}
