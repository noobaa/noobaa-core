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
        crumbsGenerator: _generateDataBucketCrumbs
    },
    [routes.namespaceBucket]: {
        panel: 'namespace-bucket',
        area: 'buckets',
        crumbsGenerator: _generateNamespaceBucketCrumbs
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
    [routes.cloudResource]: {
        area: 'resources',
        panel: 'cloud-resource',
        crumbsGenerator: _generateCloudResourceCrumb
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
    [routes.accounts]: {
        area: 'accounts',
        panel: 'accounts',
        crumbsGenerator: _generateAccountsCrumbs
    },
    [routes.account]: {
        area: 'accounts',
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
    },
    [routes.analytics]: {
        area: 'analytics',
        panel: 'analytics',
        crumbsGenerator: _generateAnalyticsCrumbs
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
        },
        {
            url: realizeUri(
                routes.buckets,
                pick(params, ['system', 'tab'])
            ),
            label: (!params.tab && 'Data Buckets') ||
                (params.tab === 'data-buckets' && 'Data Buckets') ||
                (params.tab === 'namespace-buckets' && 'Namespace Buckets')
        }
    ];
}

function _generateDataBucketCrumbs(params) {
    return [
        ..._generateBucketsCrumbs({
            ...params,
            tab: 'data-buckets'
        }),
        {
            url: realizeUri(
                routes.bucket,
                pick(params, ['system', 'bucket'])
            ),
            label: params.bucket
        }
    ];
}

function _generateNamespaceBucketCrumbs(params) {
    return [
        ..._generateBucketsCrumbs({
            ...params,
            tab: 'namespace-buckets'
        }),
        {
            url: realizeUri(
                routes.namespaceBucket,
                pick(params, ['system', 'bucket'])
            ),
            label: params.bucket
        }
    ];
}

function _generateObjectCrumbs(params) {
    return [
        ..._generateDataBucketCrumbs(params),
        {
            url: realizeUri(
                routes.object,
                pick(params, ['system', 'bucket', 'object', 'version'])
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
        },
        {
            url: realizeUri(
                routes.resources,
                pick(params, ['system', 'tab'])
            ),
            label: (!params.tab  && 'Node Pools') ||
                (params.tab === 'pools' && 'Node Pools') ||
                (params.tab === 'cloud' && 'Cloud Resources') ||
                (params.tab === 'namespace' && 'Namespace Resources')
        }
    ];
}

function _generatePoolCrumbs(params) {
    return [
        ..._generateResourcesCrumb({
            ...params, tab:
            'pools'
        }),
        {
            url: realizeUri(
                routes.pool,
                pick(params, ['system', 'pool']),
            ),
            label: params.pool
        }
    ];
}

function _generateCloudResourceCrumb(params) {
    return [
        ..._generateResourcesCrumb({
            ...params,
            tab: 'cloud'
        }),
        {
            url: realizeUri(
                routes.cloudResource,
                pick(params, ['system', 'resource'])
            ),
            label: params.resource
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

function _generateAccountsCrumbs(params) {
    return [
        {
            url: realizeUri(
                routes.accounts,
                pick(params, ['system'])
            ),
            label: 'Accounts'
        }
    ];
}

function _generateAccountCrumbs(params) {
    return [
        ..._generateAccountsCrumbs(params),
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

function _generateAnalyticsCrumbs(params) {
    return [
        {
            url:realizeUri(
                routes.analytics,
                pick(params, ['system'])
            ),
            label: 'Analytics'
        }
    ];
}
