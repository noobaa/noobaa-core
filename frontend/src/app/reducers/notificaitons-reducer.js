/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    HIDE_NOTIFICATION,
    FAIL_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_BUCKET_QUOTA,
    SHOW_NOTIFICATION,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS
} from 'action-types';

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

function onHideNotification(notifications, { payload}) {
    const newlist = notifications.list
        .filter(notification => notification.id != payload.id);

    return { ...notifications, list: newlist };
}

function onFailCreateAccount(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `Creating account ${payload.email} failed`,
        'error'
    );
}

function onCompleteUpdateAccountS3Access(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `${payload.accountName} S3 access updated successfully`,
        'success'
    );
}

function onFailUpdateAccountS3Access(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `Updating ${payload.accountName} S3 access failed`,
        'error'
    );
}

function onFailUpdateBucketQuota(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `Updating quota for ${payload.bucket} failed`,
        'error'
    );
}

function onCompleteSetAccountIpRestrictions(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `IP restrictions for ${payload.accountName} set successfully`,
        'success'
    );
}

function onFailSetAccountIpRestrictions(notifications, { payload }) {
    return _queueNotification(
        notifications,
        `Setting IP restrictions for ${payload.accountName} failed`,
        'error'
    );
}

// --------------------------------------------------------------------
// REFACTOR: this is used for backword compatability where
// that sender is an old architecture action
// --------------------------------------------------------------------
function onShowNotification(notifications, { payload }) {
    const { severity, message } = payload;
    return _queueNotification(notifications, message, severity);
}

// ------------------------------
// Local util functions
// ------------------------------
function _queueNotification(notifications, message, severity) {
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
    [FAIL_UPDATE_ACCOUNT_S3_ACCESS]: onFailUpdateAccountS3Access,
    [FAIL_UPDATE_BUCKET_QUOTA]: onFailUpdateBucketQuota,
    [COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS]: onCompleteSetAccountIpRestrictions,
    [FAIL_SET_ACCOUNT_IP_RESTRICTIONS]: onFailSetAccountIpRestrictions,
    [SHOW_NOTIFICATION]: onShowNotification,
});
