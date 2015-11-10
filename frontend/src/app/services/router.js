import page from 'page';
import { parseQueryString } from 'utils';
import { appState } from 'shared-streams';

class Router {
	constructor() {
		Object.freeze(this);
	}

	add(route, overrides) {
		page(route, ctx => {
			let state = Object.freeze({
				path: ctx.pathname.split('#')[0],
				route: route,
				hash: parseQueryString(ctx.hash),
				params: Object.freeze(
					Object.assign(
						ctx.params, 
						parseQueryString(ctx.querystring),
						overrides
					)
				)
			});

			appState.onNext(state);
		});

		return this;
	}

	redircet(fromUri, toUri) {
		page.redirect(fromUri, toUri);
		return this;
	}

	goto(url) {
		page.show(url);	
	}

	back() {
		history.back()
	}

	replace(uri) {
		page.redirect('#');
	}	

	start() {
		page();
	}
}

export default new Router();