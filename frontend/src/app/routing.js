/* Copyright (C) 2016 NooBaa */

import { mapValues, noop } from 'utils/core-utils';
import { parseQueryString } from 'utils/browser-utils';
import * as routes from 'routes';
import * as actions from 'actions';
import { action$ } from 'state';
import { sessionInfo } from 'model';
import { changeLocation } from 'action-creators';

const protocol = global.location.protocol.slice(0, -1);
const hostname = global.location.hostname;

// Register a route handler
function registerRouteHandler(page, route, extra = noop) {
    page(
        route,
        ctx => {
            const query = parseQueryString(ctx.querystring);
            const { ['0']: _, ...params } = ctx.params;
            const decodedParams = mapValues(params, p => p && decodeURIComponent(p));

            // Update state about location:
            action$.onNext(changeLocation({
                protocol,
                hostname,
                pathname: ctx.pathname,
                route: route !== '*' ? route : undefined,
                params: decodedParams,
                query
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
    registerRouteHandler(page, routes.namespaceBucket);
    registerRouteHandler(page, routes.object);
    registerRouteHandler(page, routes.resources);
    registerRouteHandler(page, routes.pool);
    registerRouteHandler(page, routes.host);
    registerRouteHandler(page, routes.account);
    registerRouteHandler(page, routes.management);
    registerRouteHandler(page, routes.accounts);
    registerRouteHandler(page, routes.cluster);
    registerRouteHandler(page, routes.server);
    registerRouteHandler(page, routes.funcs);
    registerRouteHandler(page, routes.func, actions.showFunc);

    // Catch unknown routes handler
    registerRouteHandler(page, '*');
}
