import { parseQueryString } from 'utils';
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
    page(routes.system, saveContext, actions.showOverview);
    page(routes.buckets, saveContext, actions.showBuckets);
    page(routes.bucket, saveContext, actions.showBucket);
    page(routes.object, saveContext, actions.showObject);
    page(routes.pools,  saveContext, actions.showResources);
    page(routes.pool, saveContext, actions.showPool);
    page(routes.node, saveContext, actions.showNode);
    page(routes.management, saveContext, actions.showManagement);
    page(routes.cluster, saveContext, actions.showCluster);
    page(routes.funcs, saveContext, actions.showFuncs);
    page(routes.func, saveContext, actions.showFunc);

    // Unknown paths
    page('*', actions.handleUnknownRoute);
}
