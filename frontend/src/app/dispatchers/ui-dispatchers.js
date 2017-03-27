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
