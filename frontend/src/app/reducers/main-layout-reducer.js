import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { createReducer } from 'utils/reducer-utils';
import * as routes from 'routes';

const routeMapping = deepFreeze({
    [routes.system]: {
        area: 'overview',
        panel: 'overview',
        crumbsGenerator: _generateOverviewCrumbs
    },
    [routes.buckets]: {
        area: 'buckets',
        panel: 'buckets',
        crumbsGenerator: _generateBucketsCrumbs
    },
    [routes.bucket]: {
        panel: 'bucket',
        area: 'buckets',
        crumbsGenerator: _generateBucketCrumbs
    },
    [routes.object]: {
        area: 'buckets',
        panel: 'object',
        crumbsGenerator: _generateObjectCrumbs
    },
    [routes.pools]: {
        area: 'resources',
        panel: 'resources',
        crumbsGenerator: _generateResourcesCrumb
    },
    [routes.pool]: {
        area: 'resources',
        panel: 'pool',
        crumbsGenerator: _generatePoolCrumbs
    },
    [routes.node]: {
        area: 'resources',
        panel: 'node',
        crumbsGenerator: _generateNodeCrumbs
    },
    [routes.management]: {
        area: 'management',
        panel: 'management',
        crumbsGenerator: _generateManagementCrumbs
    },
    [routes.account]: {
        area: 'management',
        panel: 'account',
        crumbsGenerator: _generateAccountCrumbs
    },
    [routes.cluster]: {
        area: 'cluster',
        panel: 'cluster',
        crumbsGenerator: _generateClusterCrumbs
    },
    [routes.server]: {
        area: 'cluster',
        panel: 'server',
        crumbsGenerator: _generateServerCrumbs
    },
    [routes.funcs]: {
        area: 'funcs',
        panel: 'funcs',
        crumbsGenerator: _generateFunctionsCrumbs
    },
    [routes.func]: {
        area: 'funcs',
        panel: 'func',
        crumbsGenerator: _generateFunctionCrumbs
    }
});
// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    name: 'main',
    panel: '',
    area: '',
    breadcrumbs: []
};

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return initialState;
}

function onSignedIn() {
    return initialState;
}

function onSessionRestored() {
    return initialState;
}

function onLocationChanged(state, { route, params } ) {
    const { panel, area, crumbsGenerator } = routeMapping[route] || {};
    if (panel) {
        const breadcrumbs = crumbsGenerator(params);
        return { ...state, area, panel, breadcrumbs };

    } else {
        return initialState;
    }
}

// ------------------------------
// Breadcrumbs generators
// ------------------------------
function _generateOverviewCrumbs(params) {
    return [
        {
            url: realizeUri(routes.system, params),
            label: 'Overview'
        }
    ];
}

function _generateBucketsCrumbs(params) {
    return [
        {
            url: realizeUri(routes.buckets, params),
            label: 'Buckets'
        }
    ];
}

function _generateBucketCrumbs(params) {
    return [
        ..._generateBucketsCrumbs(params),
        {
            url: realizeUri(routes.bucket, params),
            label: params.bucket
        }
    ];
}

function _generateObjectCrumbs(params) {
    return [
        ..._generateBucketCrumbs(params),
        {
            url: realizeUri(routes.object, params),
            label: params.object
        }
    ];
}

function _generateResourcesCrumb(params) {
    return [
        {
            url: realizeUri(routes.pools, params),
            label: 'Resources'
        }
    ];
}

function _generatePoolCrumbs(params) {
    return [
        ..._generateResourcesCrumb(params),
        {
            url: realizeUri(routes.pool, params),
            label: params.pool
        }
    ];
}

function _generateNodeCrumbs(params) {
    return [
        ..._generatePoolCrumbs(params),
        {
            url: realizeUri(routes.node, params),
            label: params.node
        }
    ];
}

function _generateManagementCrumbs(params) {
    return [
        {
            url: realizeUri(routes.management, params),
            label: 'System Management'
        }
    ];
}

function _generateAccountCrumbs(params) {
    return [
        ..._generateManagementCrumbs(params),
        {
            url: realizeUri(routes.account, params),
            label: params.account
        }
    ];
}

function _generateClusterCrumbs(params) {
    return [
        {
            url: realizeUri(routes.cluster, params),
            label: 'Cluster'
        }
    ];
}

function _generateServerCrumbs(params) {
    return [
        ..._generateClusterCrumbs(params),
        {
            url: realizeUri(routes.server, params),
            label: params.server
        }
    ];
}

function _generateFunctionsCrumbs(params) {
    return [
        {
            url: realizeUri(routes.funcs, params),
            label: 'Functions'
        }
    ];
}

function _generateFunctionCrumbs(params) {
    return [
        ..._generateFunctionsCrumbs(params),
        {
            url: realizeUri(routes.func, params),
            label: params.func
        }
    ];
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    SESSION_RESTORED: onSessionRestored,
    SIGNED_IN: onSignedIn,
    LOCATION_CHANGED: onLocationChanged
});
