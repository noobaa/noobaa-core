import { dispatch } from 'state-actions';

/// -------------------------------
/// Drawer action dispatchers
/// -------------------------------
export function openDrawer(component) {
    dispatch({ type: 'DRAWER_OPEN', component });
}

export function closeDrawer() {
    dispatch({ type: 'DRAWER_CLOSE' });
}

/// -------------------------------
/// Modal action dispatchers
/// -------------------------------

export function openModal(component, options) {
    dispatch({ type: 'MODAL_OPEN', component, options });
}

export function updateModal(options) {
    dispatch({ type: 'MODAL_UPDATE', ...options });
}

export function closeModal() {
    dispatch({ type: 'MODAL_CLOSE' });
}

export function openAddCloudResrouceModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component:'add-cloud-resource-modal',
        options: {
            title: 'Add Cloud Resource 1234',
            size: 'medium'
        }
    });
}
