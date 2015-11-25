import { parseQueryString } from 'utils';
import { sessionInfo, routeContext } from 'model';
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
			let returnUrl = encodeURIComponent(ctx.pathname);
			page.redirect(`/login?return-url=${returnUrl}`);

		} else if (session.system !== ctx.params.system) {
			page.redirect('/unauthorized');

		} else {
			next();
		}
	}

	// General midlleware that saves the current route contexts. 
	function saveContext(ctx, next) {
		routeContext(ctx);
		next();
	}

	// Parse the query string into a query object.
	page('*', parseQuery)

	// Check authentication and authorization for the following paths.
	page('/systems/:system', authorize);
	page('/systems/:system/*', authorize);

	// Screens handlers.
	page('/login', saveContext, actions.showLogin)
	page('/systems/:system', saveContext, actions.showOverview);
	page('/systems/:system/buckets', saveContext, actions.showBuckets);
	page('/systems/:system/buckets/:bucket/:tab?', saveContext, actions.showBucket);
	page('/systems/:system/buckets/:bucket/objects/:object/:tab?', saveContext, actions.showObject);
	page('/systems/:system/pools',  saveContext, actions.showPools);
	page('/systems/:system/pools/:pool/:tab?', saveContext, actions.showPool);
	page('/systems/:system/pools/:pool/nodes/:node/:tab?', saveContext, actions.showNode);
		
	// Redirect any other request to the login page.
	page.redirect('*', '/login');
}	



