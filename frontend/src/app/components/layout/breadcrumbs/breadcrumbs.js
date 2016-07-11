import template from './breadcrumbs.html';
import Disposable from 'disposable';
import ko from 'knockout';

class BreadcrumbsViewModel extends Disposable {
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
