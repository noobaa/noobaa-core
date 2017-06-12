/* Copyright (C) 2016 NooBaa */

import {
    FETCH_ALERTS,
    COMPLETE_FETCH_ALERTS,
    FAIL_FETCH_ALERTS,
    UPDATE_ALERTS,
    COMPLETE_UPDATE_ALERTS,
    FAIL_UPDATE_ALERTS,
    FETCH_UNREAD_ALERTS_COUNT,
    COMPLETE_FETCH_UNREAD_ALERTS_COUNT,
    FAIL_FETCH_UNREAD_ALERTS_COUNT,
    DROP_ALERTS
} from 'action-types';

export function fetchAlerts(query, limit) {
    return {
        type: FETCH_ALERTS,
        payload: { query, limit }
    };
}

export function completeFetchAlerts(requested, list) {
    return {
        type: COMPLETE_FETCH_ALERTS,
        payload: { requested, list }
    };
}

export function failFetchAlerts(error) {
    return {
        type: FAIL_FETCH_ALERTS,
        payload: { error }
    };
}

export function updateAlerts(query, read) {
    return {
        type: UPDATE_ALERTS,
        payload: { query, read }
    };
}

export function completeUpdateAlerts(query, read) {
    return {
        type: COMPLETE_UPDATE_ALERTS,
        payload: { query, read }
    };
}

export function failUpdateAlerts(query, read, error) {
    return {
        type: FAIL_UPDATE_ALERTS,
        payload: { query, read , error }
    };
}

export function fetchUnreadAlertsCount() {
    return { type: FETCH_UNREAD_ALERTS_COUNT };
}

export function completeFetchUnreadAlertsCount(crit, major, info) {
    return {
        type: COMPLETE_FETCH_UNREAD_ALERTS_COUNT,
        payload: { crit, major, info }
    };
}

export function failFetchUnreadAlertsCount(error) {
    return {
        type: FAIL_FETCH_UNREAD_ALERTS_COUNT,
        payload: { error }
    };
}

export function dropAlerts() {
    return { type: DROP_ALERTS };
}
