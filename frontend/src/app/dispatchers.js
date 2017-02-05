import { dispatch } from 'state-actions';
import api from 'services/api';

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
/// Alerts action dispatchers
/// -------------------------------

export async function loadAlerts(query, limit) {
    dispatch({ type: 'ALERTS_LOAD', query, limit });

    try {
        const list = await api.events.read_alerts({ query, limit });
        dispatch({ type: 'ALERTS_LOADED', requested: limit, list });

    } catch (error) {
        dispatch({ type: 'ALERTS_LOAD_FAILED', error });
    }
}

export async function updateAlerts(query, read) {
    dispatch({ type: 'ALERTS_UPDATE', query });

    try {
        await api.events.update_alerts_state({ query, state: read });
        dispatch({ type: 'ALERTS_UPDATED', query, read });

    } catch (error) {
        dispatch({ type: 'ALERTS_UPDATE_FAILED', query });
    }
}

export async function getUnreadAlertsCount() {
    const count = await api.events.get_unread_alerts_count();
    dispatch({ type: 'ALERTS_UPDATE_UNREAD_COUNT', count });
}

export function dropAlertsState() {
    dispatch({ type: 'ALERTS_DROP_STATE' });
}
