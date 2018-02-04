/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { SET_ACCOUNT_IP_RESTRICTIONS } from 'action-types';
import { completeSetAccountIpRestrictions, failSetAccountIpRestrictions } from 'action-creators';
import { splitIPRange } from 'utils/net-utils';

export default function(action$, { api }) {
    return action$
        .ofType(SET_ACCOUNT_IP_RESTRICTIONS)
        .flatMap(async action => {
            const { accountName: email, allowedIps } = action.payload;
            const ips = allowedIps && allowedIps.map(splitIPRange);

            try {
                await api.account.update_account({ email, ips });
                return completeSetAccountIpRestrictions(email);

            } catch (error) {
                return failSetAccountIpRestrictions(
                    email,
                    mapErrorObject(error)
                );
            }
        });
}
