import template from './breadcrumbs.html';
import ko from 'knockout';

class BreadcrumbsViewModel {
    constructor({ crumbs }) {
        this.crumbs = ko.pureComputed(
            () => crumbs() && crumbs()
                .reduce(this._reduceCrumbs, [])
                .slice(1)
        );


        this.hasBackground = ko.pureComputed(
            () => crumbs() && crumbs().length > 1
        );
    }

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
