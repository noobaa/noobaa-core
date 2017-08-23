/* Copyright (C) 2016 NooBaa */

import { noop } from 'utils/core-utils';
import { parseQueryString, realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import * as actions from 'actions';
import { action$ } from 'state';
import { sessionInfo } from 'model';
import { changeLocation } from 'action-creators';

const protocol = global.location.protocol.slice(0, -1);

// Register a route handler
function registerRouteHandler(page, route, extra = noop) {
    page(
        route,
        ctx => {
            const query = parseQueryString(ctx.querystring);
            const { ['0']: _, ...params } = ctx.params;

            // Update state about location:
            action$.onNext(changeLocation({
                protocol: protocol,
                pathname: ctx.pathname,
                route: route !== '*' ? route : undefined,
                params: params,
                query: query
            }));

            // Do extra work if authorized
            if (sessionInfo() && !sessionInfo().passwordExpired) {
                extra();
            }
        }
    );


}

export default function routing(page) {

    // Route handlers.
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

    // Unknown route handler - redirect to system route.
    registerRouteHandler(page, '*', () => {
        const uri = realizeUri(routes.system, { system: sessionInfo().system });
        page.redirect(uri);
    });
}
