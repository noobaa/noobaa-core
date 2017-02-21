import template from './main-layout.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import ko from 'knockout';
import { registerForAlerts } from 'actions';

class MainLayoutViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.breadcrumbs = ko.observable([]);
        this.panel = ko.observable();

        registerForAlerts();
    }

    stateEventFilter(state) {
        return [ state.layout ];
    }

    onState({ layout }) {
        const { breadcrumbs, panel } = layout;

        this.breadcrumbs(breadcrumbs);
        this.panel(`${panel}-panel`);
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
