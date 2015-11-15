import template from './breadcrumbs.html';
import ko from 'knockout';

class BreadcrumbsViewModel {
	constructor(params) {
		this.crumbs = params.crumbs;
		
		this.textCrumbs = ko.pureComputed(
			() => this.crumbs()
				.filter((_, i) => i >= 1)
				.reduce(this._reduceCrumb, [])
		);

		this.showBackground = ko.pureComputed( 
			() => this.crumbs().length > 0
		);
	}

	_reduceCrumb(list, crumb) {
		let last = list[list.length - 1] || { href: '/demo' };
		list.push({ label: crumb, href: `${last.href}/${crumb}` });
		return list 
	}
}

export default { 
	viewModel: BreadcrumbsViewModel,
	template: template
}
