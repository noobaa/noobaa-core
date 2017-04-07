import { dispatch } from 'state-actions';

// -------------------------------
// Drawer action dispatchers
// -------------------------------
export function openAuditDrawer() {
    dispatch({ type: 'OPEN_DRAWER', component: 'audit-pane' });
}

export function openAlertsDrawer() {
    dispatch({ type: 'OPEN_DRAWER', component: 'alerts-pane' });
}

export function closeDrawer() {
    dispatch({ type: 'CLOSE_DRAWER' });
}

// -------------------------------
// Notificaitons action dispatchers
// -------------------------------
export function hideNotification(id) {
    dispatch({ type: 'HIDE_NOTIFICATION', id });
}

// --------------------------------------------------------------------
// REFACTOR: this is used for backword compatability where
// that sender is an old architecture action
// --------------------------------------------------------------------
export function showNotification(message, severity = 'info') {
    dispatch({ type: 'SHOW_NOTIFICATION', message, severity });
}


