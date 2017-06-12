/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { RESTORE_SESSION } from 'action-types';
import { completeRestoreSession, failResotreSession } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(RESTORE_SESSION)
        .flatMap(async action => {
            const { token } = action.payload;

            try {
                api.options.auth_token = token;
                const sessionInfo = await api.auth.read_auth();
                if (!sessionInfo.account) {
                    throw Object.assign(
                        new Error('Account not found'),
                        { rpc_code: 'UNAUTHORIZED'}
                    );
                }

                return completeRestoreSession(token, sessionInfo);

            } catch (error) {
                return failResotreSession(token, error);
            }
        });
}
