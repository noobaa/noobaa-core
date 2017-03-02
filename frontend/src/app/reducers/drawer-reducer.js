import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
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
    INIT_APPLICAITON: onInitApplication,
    OPEN_AUDIT_DRAWER: onOpenAuditDrawer,
    OPEN_ALERTS_DRAWER: onOpenAlertsDrawer,
    CLOSE_ACTIVE_DRAWER: onCloseActiveDrawer
});
