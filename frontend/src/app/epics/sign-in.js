/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { SIGN_IN } from 'action-types';
import { completeSignIn, failSignIn } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SIGN_IN),
        mergeMap(async action => {
            const { email, password, persistent } = action.payload;

            try {
                await api.create_auth_token({ email, password });
                const { systems } = await api.system.list_systems();
                const { name: system } = systems[0];
                const { token, info } = await api.create_auth_token({ system, email, password });
                const account = await api.account.read_account({ email: info.account.email });

                const theme = account.preferences.ui_theme.toLowerCase();
                return completeSignIn(token, info, persistent, theme);

            } catch (error) {
                return failSignIn(
                    email,
                    mapErrorObject(error)
                );
            }
        })
    );
}
