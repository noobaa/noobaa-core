import page from 'page';
import { parseQueryString } from 'utils';

class Router {
	constructor() {
		Object.freeze(this);
	}

	add(route, handler) {
		page(route, ctx => {
			handler({
				pattern: route,
				path: ctx.pathname.split('#')[0],
				hash: parseQueryString(ctx.hash),
				params: Object.freeze(
					Object.assign(
						ctx.params, 
						parseQueryString(ctx.querystring)
					)
				)
			});
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