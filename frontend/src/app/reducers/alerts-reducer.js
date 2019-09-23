/* Copyright (C) 2016 NooBaa */

import { mergeBy, isUndefined, compare } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_ALERTS,
    COMPLETE_FETCH_ALERTS,
    FAIL_FETCH_ALERTS,
    UPDATE_ALERTS,
    COMPLETE_UPDATE_ALERTS,
    FAIL_UPDATE_ALERTS,
    COMPLETE_FETCH_UNREAD_ALERTS_COUNT,
    DROP_ALERTS
} from 'action-types';

// ------------------------------
// Initial state
// ------------------------------
const initialState = {
    loading: 0,
    loadError: null,
    filter: {},
    list: [],
    endOfList: false,
    unreadCounts: {}
};

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchAlerts(state, { payload }) {
    const { query } = payload;
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

function onCompleteFetchAlerts(state, { payload }) {
    let { requested, list } = payload;
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

function onFailFetchAlerts(state, { payload }) {
    const loading = state.loading - 1;

    if (loading === 0) {
        const { message: loadError } = payload.error;
        return {
            ...state,
            loading,
            loadError
        };

    } else {
        return { ...state, loading };
    }
}

function onUpdateAlerts(state, { payload }) {
    const { query } = payload;
    const list = state.list.map(
        item => _matches(item, query) ?
            { ...item, updating: true } :
            item
    );

    return { ...state, list };
}

function onCompleteUpdateAlerts(state, { payload }) {
    const { query, read } = payload;
    const list = state.list.map(
        item => _matches(item, query) ?
            { ...item, updating: false, read: read } :
            item
    );

    return { ...state, list };
}

function onFailUpdateAlerts(state, { payload }) {
    const { query } = payload;
    const list = state.list.map(
        item => _matches(item, query) ?
            { ...item, updating: false } :
            item
    );

    return { ...state, list };
}

function onCompleteFetchUnreadAlertsCount(state, { payload }) {
    return { ...state, unreadCounts: payload };
}

function onDropAlerts(state) {
    const { unreadCounts } = state;
    return { ...initialState, unreadCounts };
}

// ------------------------------
// Local util functions
// ------------------------------
function _matches(item, { ids, severity, read }) {
    return true &&
        (isUndefined(ids) || ids.includes(item.id)) &&
        (isUndefined(severity) || item.severity === severity) &&
        (isUndefined(read) || item.read === read);
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [FETCH_ALERTS]: onFetchAlerts,
    [COMPLETE_FETCH_ALERTS]: onCompleteFetchAlerts,
    [FAIL_FETCH_ALERTS]: onFailFetchAlerts,
    [UPDATE_ALERTS]: onUpdateAlerts,
    [COMPLETE_UPDATE_ALERTS]: onCompleteUpdateAlerts,
    [FAIL_UPDATE_ALERTS]: onFailUpdateAlerts,
    [COMPLETE_FETCH_UNREAD_ALERTS_COUNT]: onCompleteFetchUnreadAlertsCount,
    [DROP_ALERTS]: onDropAlerts
});
