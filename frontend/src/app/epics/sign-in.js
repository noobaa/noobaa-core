/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { SIGN_IN } from 'action-types';
import { completeSignIn, failSignIn } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(SIGN_IN)
        .flatMap(async action => {
            const { email, password } = action.payload;

            try {
                await api.create_auth_token({ email, password });
                const { systems } = await api.system.list_systems();
                const { name: system } = systems[0];
                const { token, info } = await api.create_auth_token({ system, email, password });

                return completeSignIn(token, info);

            } catch (error) {
                return failSignIn(email, error);
            }
        });
}
