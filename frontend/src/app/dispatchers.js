import { dispatch } from 'actions.new';
import api from 'services/mock-api';

export  async function loadAlerts(filter, count, till) {
    dispatch({ type: 'ALERTS_LOAD', filter, count, till });

    try {
        const list = await api.events.read_alerts({
            read: filter.read,
            severity: filter.severity,
            limit: count,
            till
        });

        dispatch({ type: 'ALERTS_LOADED', filter, requested: count, list });

    } catch (error) {
        dispatch({ type: 'ALERTS_LOAD_FAILED', error });
    }
}

export function filterAlerts(filter) {
    dispatch({ type: 'ALERTS_FILTER', filter });
}

export async function updateAlerts(filter, read) {
    dispatch({ type: 'ALERTS_UPDATE', filter, read });

    await api.events.mark_alerts_read({
        filter, state: read
    });

    dispatch({ type: 'ALERTS_UPDATED', filter, read});
}

export function dropAlerts() {
    dispatch({ type: 'ALERTS_DROP' });
}
