import { parseQueryString } from 'utils/all';
import { sessionInfo, routeContext } from 'model';
import * as routes from 'routes';
import * as actions from 'actions';

export default function routing(page) {
    // General midlleware that saves the current route contexts.
    function saveContext(ctx, next) {
        ctx.query = parseQueryString(ctx.querystring);
        routeContext(ctx);
        next();
    }

    // General middleware that check for authorization redner login screen if neccecery.
    function authorize(ctx, next) {
        if (!sessionInfo() || sessionInfo().mustChangePassword) {
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

    // Global middlewares.
    page('*', saveContext, authorize);

    // Preload system information for system routes.
    page(routes.system, ensureSystemInfo);
    page(`${routes.system}/*`, ensureSystemInfo);

    // Screens handlers.
    page(routes.system,  actions.showOverview);
    page(routes.buckets, actions.showBuckets);
    page(routes.bucket, actions.showBucket);
    page(routes.object, actions.showObject);
    page(routes.pools,  actions.showResources);
    page(routes.pool, actions.showPool);
    page(routes.node, actions.showNode);
    page(routes.account, actions.showAccount);
    page(routes.management, actions.showManagement);
    page(routes.cluster, actions.showCluster);
    page(routes.funcs, actions.showFuncs);
    page(routes.func, actions.showFunc);

    // Unknown paths
    page('*', actions.handleUnknownRoute);
}
