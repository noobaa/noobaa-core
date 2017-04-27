/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import api from 'services/api';
import {
    START_FETCH_ALERTS, COMPLETE_FETCH_ALERTS, FAIL_FETCH_ALERTS,
    START_UPDATE_ALERTS, COMPLETE_UPDATE_ALERTS, FAIL_UPDATE_ALERTS,
    UPDATE_ALERTS_UNREAD_COUNT, DROP_ALERTS
} from 'action-types';

export async function fetchAlerts(query, limit) {
    dispatch({
        type: START_FETCH_ALERTS,
        payload: { query, limit }
    });

    try {
        const list = await api.events.read_alerts({ query, limit });
        dispatch({
            type: COMPLETE_FETCH_ALERTS,
            payload: { requested: limit, list }
        });

    } catch (error) {
        dispatch({
            type: FAIL_FETCH_ALERTS,
            payload: { error }
        });
    }
}

export async function updateAlerts(query, read) {
    dispatch({
        type: START_UPDATE_ALERTS,
        payload: { query, read }
    });

    try {
        await api.events.update_alerts_state({ query, state: read });
        dispatch({
            type: COMPLETE_UPDATE_ALERTS,
            paylod: { query, read }
        });

    } catch (error) {
        dispatch({
            type: FAIL_UPDATE_ALERTS,
            payload: { query, read , error }
        });
    }
}

export async function getUnreadAlertsCount() {
    const count = await api.events.get_unread_alerts_count();
    dispatch({
        type: UPDATE_ALERTS_UNREAD_COUNT,
        payload: { count }
    });
}

export function dropAlertsState() {
    dispatch({ type: DROP_ALERTS });
}
