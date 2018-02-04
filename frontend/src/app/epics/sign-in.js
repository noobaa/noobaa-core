/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { SIGN_IN } from 'action-types';
import { completeSignIn, failSignIn } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(SIGN_IN)
        .flatMap(async action => {
            const { email, password, persistent } = action.payload;

            try {
                await api.create_auth_token({ email, password });
                const { systems } = await api.system.list_systems();
                const { name: system } = systems[0];
                const { token, info } = await api.create_auth_token({ system, email, password });

                return completeSignIn(token, info, persistent);

            } catch (error) {
                return failSignIn(
                    email,
                    mapErrorObject(error)
                );
            }
        });
}
