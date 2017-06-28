/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { CHANGE_ACCOUNT_PASSWORD } from 'action-types';
import { completeChangeAccountPassword, failChangeAccountPassword } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(CHANGE_ACCOUNT_PASSWORD)
        .flatMap(async action => {
            const { payload } = action;

            try {
                await api.account.reset_password({
                    verification_password: payload.verificationPassword,
                    email: payload.accountName,
                    password: payload.password,
                    must_change_password: payload.expireNewPassword
                });

                return completeChangeAccountPassword(payload.accountName, payload.expireNewPassword);

            } catch (error) {
                return failChangeAccountPassword(payload.accountName, error);
            }
        });
}
