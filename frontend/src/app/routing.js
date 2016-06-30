import { parseQueryString, realizeUri } from 'utils';
import { sessionInfo, routeContext } from 'model';
import * as routes from 'routes';
import * as actions from 'actions';

export default function routing(page) {
    // General middleware to parse the query string into a query object.
    function parseQuery(ctx, next) {
        ctx.query = parseQueryString(ctx.querystring);
        next();
    }

    // General middleware that check for authorization and redirect if necessary.
    function authorize(ctx, next) {
        let session = sessionInfo();
        if (!session) {
            let uri = realizeUri(
                routes.login,
                ctx.params,
                { 'return-url': encodeURIComponent(ctx.pathname) }
            );
            page.redirect(uri);

        } else if (session.system !== ctx.params.system) {
            page.redirect(routes.unauthorized);

        } else {
            next();
        }
    }

    function ensureSystemInfo(cxt, next) {
        actions.loadSystemInfo();
        next();
    }

    // General midlleware that saves the current route contexts.
    function saveContext(ctx, next) {
        routeContext(ctx);
        next();
    }

    // Parse the query string into a query object.
    page('*', parseQuery);

    // Check authentication and authorization for the following paths.
    page(routes.system, authorize, ensureSystemInfo);
    page(`${routes.system}/*`, authorize, ensureSystemInfo);

    // Screens handlers.
    page(routes.login, saveContext, actions.showLogin);
    page(routes.system, saveContext, actions.showOverview);
    page(routes.buckets, saveContext, actions.showBuckets);
    page(routes.bucket, saveContext, actions.showBucket);
    page(routes.object, saveContext, actions.showObject);
    page(routes.pools,  saveContext, actions.showResources);
    page(routes.pool, saveContext, actions.showPool);
    page(routes.node, saveContext, actions.showNode);
    page(routes.management, saveContext, actions.showManagement);
    page(routes.cluster, saveContext, actions.showCluster);

    // Redirect any other request to the login page.
    page.redirect('*', routes.login);
}



