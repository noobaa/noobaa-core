// ----------------------------------------------------------------------
// TODO: Bridge between old and new architectures. will be removed after
// appropriate sections are moved to the new architecture.
// ----------------------------------------------------------------------
import * as model from 'model';
import * as routes from 'routes';
import { refresh, redirectTo } from 'actions';
import api from 'services/api';
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
    refresh();
}

function onFailSignIn({ error }) {
    if (error.rpc_code === 'UNAUTHORIZED') {
        model.loginInfo({
            retryCount: model.loginInfo().retryCount + 1
        });

    } else {
        throw error;
    }
}

function onCompleteRestoreSession(payload) {
    model.sessionInfo(payload);
    page.start();
}

function onFailRestoreSession({ error }) {
    if (error.rpc_code === 'UNAUTHORIZED') {
        if (api.options.auth_token) {
            api.options.auth_token = undefined;
        }

        page.start();
    } else {
        throw error;
    }
}

function onSignOut() {
    api.options.auth_token = undefined;
    model.sessionInfo(null);
    refresh();
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

function onCompleteChangeAccountPassword({ accountName, expirePassword }) {
    const session = model.sessionInfo();
    if (accountName === session.user) {
        model.sessionInfo({
            ...session,
            passwordExpired: expirePassword
        });
    }

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
    [FAIL_CHANGE_ACCOUNT_PASSWORD]: onFailChangeAccountPassword,
});


export default function (action$) {
    action$.subscribe(action => {
        const { type, payload } = action;
        const handler = actionHandlers[type];
        if (handler) handler(payload);
    });
}
