import template from './breadcrumbs.html';
import Disposable from 'disposable';

class BreadcrumbsViewModel extends Disposable {
    constructor({ crumbs }) {
        super();
        this.crumbs = crumbs;
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
