import { dispatcher } from 'actions.new';
import api from 'services/api';

export const loadAlerts = dispatcher(
    async dispatch => {
        dispatch({ type: 'LOADING_ALERTS' });
        const { alerts } = await api.events.read_alerts({});
        dispatch({ type: 'ALERTS_LOADED', alerts });
    }
);
