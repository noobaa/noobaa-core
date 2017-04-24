/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import api from 'services/api';
import { ALERTS_FETCH, ALERTS_FETCHED, ALERTS_FETCH_FAILED,
    ALERTS_UPDATE, ALERTS_UPDATED, ALERTS_UPDATE_FAILED,
    ALERTS_UPDATE_UNREAD_COUNT, ALERTS_DROP_STATE } from 'action-types';

export async function fetchAlerts(query, limit) {
    dispatch({ type: ALERTS_FETCH, query, limit });

    try {
        const list = await api.events.read_alerts({ query, limit });
        dispatch({ type: ALERTS_FETCHED, requested: limit, list });

    } catch (error) {
        dispatch({ type: ALERTS_FETCH_FAILED, error });
    }
}

export async function updateAlerts(query, read) {
    dispatch({ type: ALERTS_UPDATE, query });

    try {
        await api.events.update_alerts_state({ query, state: read });
        dispatch({ type: ALERTS_UPDATED, query, read });

    } catch (error) {
        dispatch({ type: ALERTS_UPDATE_FAILED, query });
    }
}

export async function getUnreadAlertsCount() {
    const count = await api.events.get_unread_alerts_count();
    dispatch({ type: ALERTS_UPDATE_UNREAD_COUNT, count });
}

export function dropAlertsState() {
    dispatch({ type: ALERTS_DROP_STATE });
}
