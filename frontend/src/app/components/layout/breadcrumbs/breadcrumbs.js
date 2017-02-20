import template from './breadcrumbs.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import ko from 'knockout';

class BreadcrumbsViewModel extends StateAwareViewModel {
    constructor() {
        super();
        this.crumbs = ko.observable();
    }

    stateEventsFilter(state) {
        return [ state.breadcrumbs ];
    }

    onState({ breadcrumbs }) {
        this.crumbs(breadcrumbs);
    }
}

export default {
    viewModel: BreadcrumbsViewModel,
    template: template
};
