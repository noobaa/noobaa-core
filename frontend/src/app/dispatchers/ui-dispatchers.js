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
// Forms action dispatchers
// -------------------------------
export function initializeForm(form, values = {}) {
    dispatch({ type: 'INIT_FORM', form, values });
}

export function updateForm(form, field, value) {
    dispatch({ type: 'UPDATE_FORM', form, field, value });
}

export function resetForm(form) {
    dispatch({ type: 'REST_FORM', form });
}

export function disposeForm(form) {
    dispatch({ type: 'DISPOSE_FORM', form });
}

// -------------------------------
// Modal action dispatchers
// -------------------------------
export function updateModal(options) {
    dispatch({ type: 'MODAL_UPDATE', ...options });
}

export function closeActiveModal() {
    dispatch({ type: 'CLOSE_ACTIVE_MODAL' });
}

export function lockActiveModal() {
    dispatch({ type: 'LOCK_ACTIVE_MODAL' });
}
