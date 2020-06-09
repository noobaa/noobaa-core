/* Copyright (C) 2016 NooBaa */

// ----------------------------------------------------------------------
// TODO: Bridge between old and new architectures. will be removed after
// appropriate sections are moved to the new architecture.
// ----------------------------------------------------------------------
import * as model from 'model';
import * as routes from 'routes';
import { redirectTo } from 'actions';
import { api } from 'services';
import page from 'page';
import { deepFreeze } from 'utils/core-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    COMPLETE_SIGN_IN,
    FAIL_SIGN_IN,
    COMPLETE_RESTORE_SESSION,
    FAIL_RESTORE_SESSION,
    SIGN_OUT,
    COMPLETE_CREATE_SYSTEM,
    CHANGE_LOCATION,
    CHANGE_ACCOUNT_PASSWORD,
    COMPLETE_CHANGE_ACCOUNT_PASSWORD,
    FAIL_CHANGE_ACCOUNT_PASSWORD
} from 'action-types';

const endpoint = global.location.hostname;

function onCompleteFetchSystemInfo(payload) {
    model.systemInfo({ ...payload, endpoint });
}

function onCompleteSignIn(payload) {
    model.sessionInfo(payload);
    model.loginInfo({ retryCount: 0 });
}

function onFailSignIn({ error }) {
    if (error.rpc_code === 'UNAUTHORIZED') {
        model.loginInfo({
            unauthorized: error.message,
            retryCount: model.loginInfo().retryCount + 1
        });

    } else {
        throw error;
    }
}

function onCompleteRestoreSession(payload) {
    model.sessionInfo(payload);
    page.start({ decodeURLComponents: false });
}

function onFailRestoreSession({ error }) {
    if (error.rpc_code === 'UNAUTHORIZED') {
        if (api.options.auth_token) {
            api.options.auth_token = undefined;
        }

        model.sessionInfo(null);
        page.start({ decodeURLComponents: false });
    } else {
        throw error;
    }
}

function onSignOut() {
    api.options.auth_token = undefined;
    model.sessionInfo(null);
}

function onCompleteCreateSystem(payload) {
    const { token, system } = payload;
    api.options.auth_token = token;
    model.sessionInfo(payload);
    redirectTo(routes.system, { system }, { welcome: true });
}

function onChangeLocation(payload) {
    model.routeContext(payload);
}

function onChangeAccountPassword() {
    model.resetPasswordState('IN_PROGRESS');
}

function onCompleteChangeAccountPassword() {
    model.resetPasswordState('SUCCESS');
}

function onFailChangeAccountPassword({ error }) {
    model.resetPasswordState(error.rpc_code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'ERROR');
}

const actionHandlers = deepFreeze({
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [COMPLETE_SIGN_IN]: onCompleteSignIn,
    [FAIL_SIGN_IN]: onFailSignIn,
    [COMPLETE_RESTORE_SESSION]: onCompleteRestoreSession,
    [FAIL_RESTORE_SESSION]: onFailRestoreSession,
    [SIGN_OUT]: onSignOut,
    [COMPLETE_CREATE_SYSTEM]: onCompleteCreateSystem,
    [CHANGE_LOCATION]: onChangeLocation,
    [CHANGE_ACCOUNT_PASSWORD]: onChangeAccountPassword,
    [COMPLETE_CHANGE_ACCOUNT_PASSWORD]: onCompleteChangeAccountPassword,
    [FAIL_CHANGE_ACCOUNT_PASSWORD]: onFailChangeAccountPassword
});


export default function (action$) {
    action$.subscribe(action => {
        const { type, payload } = action;
        const handler = actionHandlers[type];
        if (handler) handler(payload);
    });
}
