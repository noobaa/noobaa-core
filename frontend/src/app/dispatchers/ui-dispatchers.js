/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state';
import { OPEN_DRAWER, CLOSE_DRAWER, HIDE_NOTIFICATION, SHOW_NOTIFICATION } from 'action-types';

// -------------------------------
// Drawer action dispatchers
// -------------------------------
export function openAuditDrawer() {
    dispatch({
        type: OPEN_DRAWER,
        payload: { pane: 'audit-pane' }
    });
}

export function openAlertsDrawer() {
    dispatch({
        type: OPEN_DRAWER,
        payload: { pane: 'alerts-pane' }
    });
}

export function closeDrawer() {
    dispatch({ type: CLOSE_DRAWER });
}

// -------------------------------
// Notificaitons action dispatchers
// -------------------------------
export function hideNotification(id) {
    dispatch({
        type: HIDE_NOTIFICATION,
        payload: { id }
    });
}

// --------------------------------------------------------------------
// REFACTOR: this is used for backword compatability where
// that sender is an old architecture action
// --------------------------------------------------------------------
export function showNotification(message, severity = 'info') {
    dispatch({
        type: SHOW_NOTIFICATION,
        payload: { message, severity }
    });
}


