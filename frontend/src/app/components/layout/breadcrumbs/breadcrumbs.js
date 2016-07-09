import template from './breadcrumbs.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';

class BreadcrumbsViewModel extends BaseViewModel {
    constructor({ crumbs }) {
        super();

        this.crumbs = ko.pureComputed(
            () => crumbs() && crumbs().slice(1)
        );
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
