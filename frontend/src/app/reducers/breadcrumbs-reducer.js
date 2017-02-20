import { deepFreeze } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import * as routes from 'routes';

const routeBreadcrumbsMapping = deepFreeze({
    [routes.system]: _overviewCrumbs,
    [routes.buckets]: _bucketsCrumbs,
    [routes.bucket]: _bucketCrumbs,
    [routes.object]: _objectCrumbs,
    [routes.pools]: _resourcesCrumb,
    [routes.pool]: _poolCrumbs,
    [routes.node]: _nodeCrumbs,
    [routes.management]: _managementCrumbs,
    [routes.account]: _accountCrumbs,
    [routes.cluster]: _clusterCrumbs,
    [routes.server]: _serverCrumbs,
    [routes.funcs]: _functionsCrumbs,
    [routes.func]: _functionCrumbs
});

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return [];
}

function onLocationChanged(state, { route, params } ) {
    const handler = routeBreadcrumbsMapping[route];
    return handler ? handler(params) : state;
}

// ------------------------------
// Local util functions
// ------------------------------
function _overviewCrumbs() {
    return [
        { route: 'system', label: 'Overview' }
    ];
}

function _bucketsCrumbs() {
    return [
        { route: 'buckets', label: 'Buckets' }
    ];
}

function _bucketCrumbs(params) {
    return [
        ..._bucketsCrumbs(params),
        { route: 'bucket', label: params.bucket }
    ];
}

function _objectCrumbs(params) {
    return [
        ..._bucketCrumbs(params),
        { route: 'object',label: params.object }
    ];
}

function _resourcesCrumb() {
    return [
        { route: 'pools', label: 'Resources' }
    ];
}

function _poolCrumbs(params) {
    return [
        ..._resourcesCrumb(params),
        { route: 'pool', label: params.pool }
    ];
}

function _nodeCrumbs(params) {
    return [
        ..._poolCrumbs(params),
        { route: 'node', label: params.node }
    ];
}

function _managementCrumbs() {
    return [
        { route: 'management', label: 'System Management' }
    ];
}

function _accountCrumbs(params) {
    return [
        ..._managementCrumbs(params),
        { route: 'account', label: params.account }
    ];
}

function _clusterCrumbs() {
    return [
        { route: 'cluster', label: 'Cluster' }
    ];
}

function _serverCrumbs(params) {
    return [
        ..._clusterCrumbs(params),
        { route: 'server', label: params.server }
    ];
}

function _functionsCrumbs() {
    return [
        { route: 'funcs', label: 'Functions' }
    ];
}

function _functionCrumbs(params) {
    return [
        ..._functionsCrumbs(params),
        { route: 'func', label: params.func }
    ];
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    LOCATION_CHANGED: onLocationChanged
});
