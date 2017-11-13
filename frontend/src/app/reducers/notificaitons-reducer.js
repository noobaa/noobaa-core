/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    HIDE_NOTIFICATION,
    SHOW_NOTIFICATION
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

function onShowNotification(notifications, { payload }) {
    const { severity, message } = payload;
    const { list, nextId } = notifications;

    return {
        list: [
            ...list,
            { id: nextId, severity, message }
        ],
        nextId: nextId + 1
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [HIDE_NOTIFICATION]: onHideNotification,
    [SHOW_NOTIFICATION]: onShowNotification
});
