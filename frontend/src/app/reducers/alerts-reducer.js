import { mergeBy, isUndefined, compare } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';

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
function onInitApplication() {
    return initialState;
}

function onAlertsFetch(state, { query }) {
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

function onAlertsFetched(state, { requested, list }) {
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

function onAlertsFetchFailed(state, { error }) {
    const loading = state.loading - 1;

    if (loading === 0) {
        return { ...state, loading, loadError: error };

    } else {
        return { ...state, loading };
    }

}

function onAlertsUpdate(state, { query }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: true } :
            item
    );

    return { ...state, list };
}

function onAlertsUpdated(state, { query, read }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: false, read: read } :
            item
    );

    return { ...state, list };
}

function onAlertsUpdateFailed(state, { query }) {
    const list = state.list.map(
        item => _matchs(item, query) ?
            { ...item, updating: false } :
            item
    );

    return { ...state, list };
}

function onAlertsUpdateUnreadCount(state, { count }) {
    return { ...state, unreadCount: count };
}

function onAlertsDropState(state) {
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
export default createReducer({
    INIT_APPLICAITON: onInitApplication,
    ALERTS_FETCH: onAlertsFetch,
    ALERTS_FETCHED: onAlertsFetched,
    ALERTS_FETCH_FAILED: onAlertsFetchFailed,
    ALERTS_UPDATE: onAlertsUpdate,
    ALERTS_UPDATED: onAlertsUpdated,
    ALERTS_UPDATE_FAILED: onAlertsUpdateFailed,
    ALERTS_UPDATE_UNREAD_COUNT: onAlertsUpdateUnreadCount,
    ALERTS_DROP_STATE: onAlertsDropState
});
