import { mergeBy, isUndefined } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Default state
// ------------------------------
const defaultState = {
    loading: 0,
    filter: {},
    list: [],
    endOfList: false,
    lastLoadError: null
};


// ------------------------------
// Action Handlers
// ------------------------------
function onInit() {
    return defaultState;
}

function onAlertsLoad(state) {
    const loading = state.loading + 1;
    return { ...state, loading };
}

function onAlertsLoaded(state, { filter, requested, list }) {
    const loading = state.loading - 1;
    const lastLoadError = null;

    // Check to see if we can use the results in our current state
    //configuration.
    if (_isSubsetFilter(state.filter, filter)) {
        const endOfList = list.length < requested;

        // Merge the relevent result with the current list of alerts.
        list = list.filter(item => _matchs(item, state.filter));
        list = mergeBy(state.list, list, item => item.id)
            .sort((a, b) => b.id - a.id);

        return { ...state, list, loading, endOfList, lastLoadError };

    } else {
        return { ...state, loading, lastLoadError  };
    }
}

function onAlertsLoadFailed(state, { error }) {
    const loading = state.loading - 1;
    return { ...state, loading, lastLoadError: error };
}

function onAlertsFilter(state, { filter }) {
    const isSubsetFilter = _isSubsetFilter(filter, state.filter);
    const list = isSubsetFilter ?
        state.list.filter(item => _matchs(item, filter)) :
        [];

    const endOfList = isSubsetFilter ? state.endOfList : false;

    return { ...state, filter, list, endOfList };
}

function onAlertsUpdate(state, { filter }) {
    const list = state.list.map(
        item => _matchs(item, filter) ?
            { ...item, updating: true } :
            item
    );

    return { ...state, list };
}

function onAlertsUpdated(state, { filter, read }) {
    const list = state.list.map(
        item => _matchs(item, filter) ?
            { ...item, updating: false, read: read } :
            item
    );

    return { ...state, list };
}

function onAlertsDrop() {
    return defaultState;
}

// ------------------------------
// Local util functions
// ------------------------------
function _isSubsetFilter(subset, base) {
    return true &&
        (isUndefined(base.ids) || subset.ids.every(id => base.includes(id))) &&
        (isUndefined(base.severity) || subset.severity === base.severity) &&
        (isUndefined(base.read) || subset.read === base.read);
}

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
    INIT: onInit,
    ALERTS_LOAD: onAlertsLoad,
    ALERTS_LOADED: onAlertsLoaded,
    ALERTS_LOAD_FAILED: onAlertsLoadFailed,
    ALERTS_FILTER: onAlertsFilter,
    ALERTS_UPDATE: onAlertsUpdate,
    ALERTS_UPDATED: onAlertsUpdated,
    ALERTS_DROP: onAlertsDrop
});
