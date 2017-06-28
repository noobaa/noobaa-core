/* Copyright (C) 2016 NooBaa */

import { parseQueryString } from 'utils/browser-utils';
import { sessionInfo } from 'model';
import * as routes from 'routes';
import * as actions from 'actions';
import { dispatch } from 'state';
import { changeLocation } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';

const { protocol } = location;

// General midlleware that saves the current route contexts.
function saveContext(ctx, next) {
    ctx.query = parseQueryString(ctx.querystring);
    ctx.protocol = protocol.substr(0, protocol.length - 1);
    next();
}

// General middleware that check for authorization redner login screen if neccecery.
function authorize(ctx, next) {
    if (!sessionInfo() || sessionInfo().passwordExpired) {

        actions.showLogin();
    } else {
        next();
    }
}

// General middleware that is used to preload the system infromation.
function ensureSystemInfo(ctx, next) {
    actions.loadSystemInfo();
    next();
}

// General middleware to dispatch an action about the changed location.
function updateStateAboutLocation(route, ctx, next) {
    const { pathname, params: _params, query } = ctx;
    const { ['0']: _, ...params } = _params;
    dispatch(changeLocation({ route, pathname, params, query }));

    next();
}

// Register
function registerRouteHandler(page, route, handler) {
    page(
        route,
        (ctx, next) => updateStateAboutLocation(route, ctx, next),
        authorize,
        ensureSystemInfo,
        handler
    );
}

// An handler for unknown routes.
function registerUnknownRouteHandler(page) {
    page(
        '*',
        (ctx, next) => updateStateAboutLocation(undefined, ctx, next),
        authorize,
        () => {
            const { system } = sessionInfo();
            const uri = realizeUri(routes.system, { system });
            page.redirect(uri);
        }
    );
}


export default function routing(page) {

    // Global general middlewares.
    page('*', saveContext);

    // Screens handlers.
    registerRouteHandler(page, routes.system, actions.showOverview);
    registerRouteHandler(page, routes.buckets, actions.showBuckets);
    registerRouteHandler(page, routes.bucket, actions.showBucket);
    registerRouteHandler(page, routes.object, actions.showObject);
    registerRouteHandler(page, routes.pools,  actions.showResources);
    registerRouteHandler(page, routes.pool, actions.showPool);
    registerRouteHandler(page, routes.node, actions.showNode);
    registerRouteHandler(page, routes.account, actions.showAccount);
    registerRouteHandler(page, routes.management, actions.showManagement);
    registerRouteHandler(page, routes.cluster, actions.showCluster);
    registerRouteHandler(page, routes.server, actions.showServer);
    registerRouteHandler(page, routes.funcs, actions.showFuncs);
    registerRouteHandler(page, routes.func, actions.showFunc);

    // Unknown paths
    registerUnknownRouteHandler(page);
}
