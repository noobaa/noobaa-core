/* Copyright (C) 2016 NooBaa */

import { mergeBy, isUndefined, compare } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { START_FETCH_ALERTS, COMPLETE_FETCH_ALERTS, FAIL_FETCH_ALERTS,
    START_UPDATE_ALERTS, COMPLETE_UPDATE_ALERTS, FAIL_UPDATE_ALERTS,
    UPDATE_ALERTS_UNREAD_COUNT, DROP_ALERTS } from 'action-types';

// ------------------------------
// Initial state
// ------------------------------
const initialState = {
    loading: 0,
    loadError: null,
    filter: {},
    list: [],
    endOfList: false,
    unreadCount: undefined
};

// ------------------------------
// Action Handlers
// ------------------------------

function onStartFetchAlerts(state, { query }) {
    const loading = state.loading + 1;
    const loadError = null;
    const { severity, read } = query;
    const { filter } = state;

    if (severity === filter.severity && read === filter.read) {
        return { ...state, loading, loadError };

    } else {
        const filter = { severity, read };
        const list = [];
        const endOfList = false;

        return { ...state, loading, loadError, filter, list, endOfList };
    }
}

function onCompleteFetchAlerts(state, { requested, list }) {
    const loading = state.loading - 1;
    if (loading === 0) {
        const endOfList = list.length < requested;
        list = mergeBy(state.list, list, item => item.id)
            .sort((a, b) => -1 * compare(a.id, b.id));

        return { ...state, list, endOfList, loading };

    } else {
        return { ...state, loading };
    }
}

function onFailFetchAlerts(state, { error }) {
    const loading = state.loading - 1;

    if (loading === 0) {
        return { ...state, loading, loadError: error };

    } else {
        return { ...state, loading };
    }
}

function onStartUpdateAlerts(state, { query }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: true } :
            item
    );

    return { ...state, list };
}

function onCompleteUpdateAlerts(state, { query, read }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: false, read: read } :
            item
    );

    return { ...state, list };
}

function onFailUpdateAlerts(state, { query }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: false } :
            item
    );

    return { ...state, list };
}

function onUpdateAlertsUreadCount(state, { count }) {
    return { ...state, unreadCount: count };
}

function onDropAlerts(state) {
    const { unreadCount } = state;
    return { ...initialState, unreadCount };
}

// ------------------------------
// Local util functions
// ------------------------------
function _matchs(item, { ids, severity, read }) {
    return true &&
        (isUndefined(ids) || ids.includes(item.id)) &&
        (isUndefined(severity) || item.severity === severity) &&
        (isUndefined(read) || item.read === read);
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [START_FETCH_ALERTS]: onStartFetchAlerts,
    [COMPLETE_FETCH_ALERTS]: onCompleteFetchAlerts,
    [FAIL_FETCH_ALERTS]: onFailFetchAlerts,
    [START_UPDATE_ALERTS]: onStartUpdateAlerts,
    [COMPLETE_UPDATE_ALERTS]: onCompleteUpdateAlerts,
    [FAIL_UPDATE_ALERTS]: onFailUpdateAlerts,
    [UPDATE_ALERTS_UNREAD_COUNT]: onUpdateAlertsUreadCount,
    [DROP_ALERTS]: onDropAlerts
});
