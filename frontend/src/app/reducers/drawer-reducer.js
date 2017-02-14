import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return null;
}

function onOpenAuditDrawer() {
    return 'audit-pane';
}

function onOpenAlertsDrawer() {
    return 'alerts-pane';
}

function onCloseActiveDrawer() {
    return null;
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    OPEN_AUDIT_DRAWER: onOpenAuditDrawer,
    OPEN_ALERTS_DRAWER: onOpenAlertsDrawer,
    CLOSE_ACTIVE_DRAWER: onCloseActiveDrawer,
});
