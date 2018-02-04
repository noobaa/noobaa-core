/* Copyright (C) 2017 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { TRY_DELETE_ACCOUNT } from 'action-types';
import {
    completeDeleteAccount,
    failDeleteAccount,
    openDeleteCurrentAccountWarningModal
} from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(TRY_DELETE_ACCOUNT)
        .flatMap(async action => {
            const { email, isCurrentUser, isConfirmed } = action.payload;

            try {
                if (isCurrentUser && !isConfirmed) {
                    return openDeleteCurrentAccountWarningModal(email);
                } else {
                    await api.account.delete_account({ email });
                    return completeDeleteAccount(email, isCurrentUser);
                }
            } catch (error) {
                return failDeleteAccount(
                    email,
                    mapErrorObject(error)
                );
            }
        });
}
