/* Copyright (C) 2016 NooBaa */

import { noop } from 'utils/core-utils';
import { parseQueryString, realizeUri } from 'utils/browser-utils';
import { sessionInfo } from 'model';
import * as routes from 'routes';
import * as actions from 'actions';
import { action$ } from 'state';
import { changeLocation } from 'action-creators';

const { protocol } = location;

// General midlleware that enhance the current route contexts.
function enhanceContext(ctx, next) {
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

// General middleware to generate an action about the changed location.
function updateStateAboutLocation(route, ctx, next) {
    const { pathname, params: _params, query } = ctx;
    const { ['0']: _, ...params } = _params;
    action$.onNext(changeLocation({ route, pathname, params, query }));

    next();
}

// Register
function registerRouteHandler(page, route, extra = noop) {
    page(
        route,
        (ctx, next) => updateStateAboutLocation(route, ctx, next),
        authorize,
        ensureSystemInfo,
        extra
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
    page('*', enhanceContext);

    // Screens handlers.
    registerRouteHandler(page, routes.system);
    registerRouteHandler(page, routes.buckets);
    registerRouteHandler(page, routes.bucket);
    registerRouteHandler(page, routes.nsBucket);
    registerRouteHandler(page, routes.object, actions.showObject);
    registerRouteHandler(page, routes.resources);
    registerRouteHandler(page, routes.pool);
    registerRouteHandler(page, routes.host);
    registerRouteHandler(page, routes.account);
    registerRouteHandler(page, routes.management);
    registerRouteHandler(page, routes.cluster);
    registerRouteHandler(page, routes.server);
    registerRouteHandler(page, routes.funcs, actions.showFuncs);
    registerRouteHandler(page, routes.func, actions.showFunc);

    // Unknown paths
    registerUnknownRouteHandler(page);
}
