/* Copyright (C) 2016 NooBaa */

import { parseQueryString } from 'utils/browser-utils';
import { sessionInfo } from 'model';
import * as routes from 'routes';
import * as actions from 'actions';
import { dispatch } from 'state';
import { changeLocation } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';

const { protocol } = location;

export default function routing(page) {
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

    function registerRouteHandler(route, handler) {
        page(route, ctx => {
            const { pathname, params: _params, query } = ctx;
            const { ['0']: _, ...params } = _params;
            dispatch(changeLocation({ route, pathname, params, query }));

            // TODO REFACTOR.
            handler(ctx);
        });
    }

    function handleUnknownRoute() {
        const system = sessionInfo().system;
        const uri = realizeUri(routes.system, { system });
        page.redirect(uri);
    }

    // Global middlewares.
    page('*', saveContext, authorize);

    // Preload system information for system routes.
    page(routes.system, ensureSystemInfo);
    page(`${routes.system}/*`, ensureSystemInfo);

        // Screens handlers.
    registerRouteHandler(routes.system, actions.showOverview);
    registerRouteHandler(routes.buckets, actions.showBuckets);
    registerRouteHandler(routes.bucket, actions.showBucket);
    registerRouteHandler(routes.object, actions.showObject);
    registerRouteHandler(routes.pools,  actions.showResources);
    registerRouteHandler(routes.pool, actions.showPool);
    registerRouteHandler(routes.node, actions.showNode);
    registerRouteHandler(routes.account, actions.showAccount);
    registerRouteHandler(routes.management, actions.showManagement);
    registerRouteHandler(routes.cluster, actions.showCluster);
    registerRouteHandler(routes.server, actions.showServer);
    registerRouteHandler(routes.funcs, actions.showFuncs);
    registerRouteHandler(routes.func, actions.showFunc);

    // Unknown paths
    page('*', handleUnknownRoute);
}
