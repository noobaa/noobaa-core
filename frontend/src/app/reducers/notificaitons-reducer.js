/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { HIDE_NOTIFICATION, FAIL_CREATE_ACCOUNT, COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_ACCOUNT_S3_ACCESS_UPDATE, SHOW_NOTIFICATION } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    nextId: 0,
    list: []
};

// ------------------------------
// Action Handlers
// ------------------------------

function onHideNotification(notifications, { id }) {
    const newlist = notifications.list
        .filter(notification => notification.id != id);

    return { ...notifications, list: newlist };
}

function onFailCreateAccount(notifications, { email }) {
    _queueNotification(
        notifications,
        `Creating account ${email} failed`,
        'error'
    );
}

function onCompleteUpdateAccountS3Access(notifications, { email }) {
    _queueNotification(
        notifications,
        `${email} S3 access updated successfully`,
        'success'
    );
}

function onFailUpdateAccountS3Access(notifications, { email }) {
    _queueNotification(
        notifications,
        `Updating ${email} S3 access failed`,
        'error'
    );
}

// --------------------------------------------------------------------
// REFACTOR: this is used for backword compatability where
// that sender is an old architecture action
// --------------------------------------------------------------------
function onShowNotification(notifications, { severity, message }) {
    return _queueNotification(notifications, severity, message);
}

// ------------------------------
// Local util functions
// ------------------------------
function _queueNotification(notifications, severity, message) {
    const { list, nextId } = notifications;
    return {
        list: [ ...list, { id: nextId, severity, message } ],
        nextId: nextId + 1
    };
}


// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [HIDE_NOTIFICATION]: onHideNotification,
    [FAIL_CREATE_ACCOUNT]: onFailCreateAccount,
    [COMPLETE_UPDATE_ACCOUNT_S3_ACCESS]: onCompleteUpdateAccountS3Access,
    [FAIL_ACCOUNT_S3_ACCESS_UPDATE]: onFailUpdateAccountS3Access,
    [SHOW_NOTIFICATION]: onShowNotification
});
