import template from './breadcrumbs.html';

class BreadcrumbsViewModel {
    constructor({ crumbs = [] }) {
        this.crumbs = crumbs;
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
