import template from './breadcrumbs.html';
import ko from 'knockout';

class BreadcrumbsViewModel {
<<<<<<< HEAD
    constructor({ crumbs }) {
        this.crumbs = ko.pureComputed(
            () => crumbs()
                .reduce(this._reduceCrumbs, [])
                .slice(1)
        );


        this.hasBackground = ko.pureComputed(
            () => crumbs().length > 0
        );
    }
=======
	constructor({ crumbs }) {
		this.crumbs = ko.pureComputed(
			() => crumbs() && crumbs()
				.reduce(this._reduceCrumbs, [])
				.slice(1)
		);


		this.hasBackground = ko.pureComputed(
			() => crumbs() && crumbs().length > 0
		);
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb

    _reduceCrumbs(list, crumb, i) {
        let base = list[i-1] ? list[i-1].href : '';
        list.push({
            label: crumb.label || '',
            href: `${base}/${crumb.href}`
        });

        return list;
    }
}

export default { 
    viewModel: BreadcrumbsViewModel,
    template: template
}
