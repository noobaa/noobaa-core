/* Copyright (C) 2016 NooBaa */

import { SET_ACCOUNT_IP_RESTRICTIONS } from 'action-types';
import { completeSetAccountIpRestrictions, failSetAccountIpRestrictions } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(SET_ACCOUNT_IP_RESTRICTIONS)
        .flatMap(async action => {
            const { accountName, allowedIps } = action.payload;

            try {
                await api.account.update_account({
                    email: accountName,
                    ips: allowedIps
                });

                return completeSetAccountIpRestrictions(accountName);

            } catch (error) {
                return failSetAccountIpRestrictions(accountName, error);
            }
        });
}
