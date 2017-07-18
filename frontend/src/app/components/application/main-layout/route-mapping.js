/* Copyright (C) 2016 NooBaa */

import { deepFreeze, pick } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostDisplayName } from 'utils/host-utils';
import * as routes from 'routes';

export default deepFreeze({
    [routes.system]: {
        area: 'system',
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
    [routes.nsBucket]: {
        panel: 'ns-bucket',
        area: 'buckets',
        crumbsGenerator: _generateBucketCrumbs
    },
    [routes.object]: {
        area: 'buckets',
        panel: 'object',
        crumbsGenerator: _generateObjectCrumbs
    },
    [routes.resources]: {
        area: 'resources',
        panel: 'resources',
        crumbsGenerator: _generateResourcesCrumb
    },
    [routes.pool]: {
        area: 'resources',
        panel: 'pool',
        crumbsGenerator: _generatePoolCrumbs
    },
    [routes.host]: {
        area: 'resources',
        panel: 'host',
        crumbsGenerator: _generateHostCrumbs
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

function _generateOverviewCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.system,
                pick(params, ['system'])
            ),
            label: 'Overview'
        }
    ];
}

function _generateBucketsCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.buckets,
                pick(params, ['system'])
            ),
            label: 'Buckets'
        }
    ];
}

function _generateBucketCrumbs(params) {
    return [
        ..._generateBucketsCrumbs(params),
        {
            url: realizeUri(
                routes.bucket,
                pick(params, ['system', 'bucket'])
            ),
            label: params.bucket
        }
    ];
}

function _generateObjectCrumbs(params) {
    return [
        ..._generateBucketCrumbs(params),
        {
            url: realizeUri(
                routes.object,
                pick(params, ['system', 'bucket', 'object'])
            ),
            label: params.object
        }
    ];
}

function _generateResourcesCrumb(params) {
    return [
        {
            url: realizeUri(
                routes.resources,
                pick(params, ['system'])
            ),
            label: 'Resources'
        }
    ];
}

function _generatePoolCrumbs(params) {
    return [
        ..._generateResourcesCrumb(params),
        {
            url: realizeUri(
                routes.pool,
                pick(params, ['system', 'pool'])
            ),
            label: params.pool
        }
    ];
}

function _generateHostCrumbs(params) {
    return [
        ..._generatePoolCrumbs(params),
        {
            url: realizeUri(
                routes.host,
                pick(params, ['system', 'pool', 'host'])
            ),
            label: getHostDisplayName(params.host)
        }
    ];
}

function _generateManagementCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.management,
                pick(params, ['system'])
            ),
            label: 'System Management'
        }
    ];
}

function _generateAccountCrumbs(params) {
    return [
        ..._generateManagementCrumbs(params),
        {
            url: realizeUri(
                routes.account,
                pick(params, ['system', 'account'])
            ),
            label: params.account
        }
    ];
}

function _generateClusterCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.cluster,
                pick(params, ['system'])
            ),
            label: 'Cluster'
        }
    ];
}

function _generateServerCrumbs(params) {
    return [
        ..._generateClusterCrumbs(params),
        {
            url: realizeUri(
                routes.server,
                pick(params, ['system', 'server'])
            ),
            label: params.server
        }
    ];
}

function _generateFunctionsCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.funcs,
                pick(params, ['system'])
            ),
            label: 'Functions'
        }
    ];
}

function _generateFunctionCrumbs(params) {
    return [
        ..._generateFunctionsCrumbs(params),
        {
            url: realizeUri(
                routes.func,
                pick(params, ['system', 'func'])
            ),
            label: params.func
        }
    ];
}
