import template from './breadcrumbs.html';
import ko from 'knockout';

class BreadcrumbsViewModel {
    constructor({ crumbs }) {
        this.crumbs = ko.pureComputed(
            () => crumbs() && crumbs().slice(1)
        );
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
