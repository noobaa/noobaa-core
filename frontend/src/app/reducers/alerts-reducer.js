import { createReducer } from 'utils/reducer-utils';

function onInit() {
    return {};
}

function onLoadingAlerts() {
    return { loading: true };
}

function onAlertLoaded(_, { alerts  }) {
    return { items:  alerts };
}

export default createReducer({
    INIT: onInit,
    LOADING_ALERTS: onLoadingAlerts,
    ALERT_LOADED: onAlertLoaded
});
