/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import api from 'services/api';
import { INIT_APPLICATION, CHANGE_LOCATION, SIGN_IN, SIGN_IN_FAILED, SIGN_OUT } from 'action-types';

export async function initApplication(browser, flags, token) {
    let session = undefined;

    if (token) {
        try {
            api.options.auth_token = token;
            session = await api.auth.read_auth();
            if (!session.account) session = api.options.auth_token = undefined;

        } catch (error) {
            api.options.auth_token = undefined;
            if (error.rpc_code !== 'UNAUTHORIZED') {
                console.warn('startApplication: restore session failed', { token, flags });
            }
        }
    }

    dispatch({
        type: INIT_APPLICATION,
        payload: { browser, flags, session }
    });
}

export async function signIn(email, password, /*keepSessionAlive = false*/) {
    try {
        await api.create_auth_token({ email, password });
        const [ system ] = await api.system.list_systems();
        const { /*token,*/ info } = await api.create_auth_token({ system, email, password });
        dispatch({ type: SIGN_IN, ...info });

    } catch (error) {
        if (error.rpc_code !== 'UNAUTHORIZED') {
            dispatch({
                type: SIGN_IN_FAILED,
                payload: { email, error }
            });
        }
    }
}

export function signOut() {
    api.options.auth_token = undefined;
    dispatch({ type: SIGN_OUT });
}

export function changeLocation(location) {
    dispatch({
        type: CHANGE_LOCATION,
        payload: location
    });
}

