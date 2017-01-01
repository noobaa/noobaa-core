import template from './breadcrumbs.html';
import BaseViewModel from 'base-view-model';

class BreadcrumbsViewModel extends BaseViewModel {
    constructor({ crumbs }) {
        super();
        this.crumbs = crumbs;
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
