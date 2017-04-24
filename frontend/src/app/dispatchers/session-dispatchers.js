/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import api from 'services/api';
import { RESOTRING_SESSION, SESSION_RESTORED, RESOTREING_SESSION_FAILED,
    SIGN_OUT, SIGNING_IN, SIGN_IN_FAILED, SIGNED_IN } from 'action-types';

export async function restoreSession() {
    const authToken = sessionStorage.getItem('sessionToken') ||
        localStorage.getItem('sessionToken');

    try {
        dispatch({ type: RESOTRING_SESSION, authToken });

        api.options.auth_token = authToken;
        const { account, system, role } = await api.auth.read_auth();

        dispatch({ type: SESSION_RESTORED, account, system, role });

    } catch(error) {
        dispatch({ type: RESOTREING_SESSION_FAILED, authToken, error });
    }
}

export function signOut() {
    dispatch({ type: SIGN_OUT });
}

export async function signIn(email, password /*, keepSessionAlive = false*/) {
    try {
        dispatch({ type: SIGNING_IN, email });

        await api.create_auth_token({ email, password });
        const systems = api.system.list_systems();

        if (systems.length > 0) {
            const systemName = systems[0].name;
            const { info } = await api.create_auth_token({
                system: systemName, email, password
            });
            // const longLived = keepSessionAlive;

            dispatch({ type: SIGNED_IN, ...info });
        }
    } catch (error) {
        dispatch({ type: SIGN_IN_FAILED, email, error });
    }
}
