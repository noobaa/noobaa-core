import template from './alerts-pane.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import { closeDrawer } from 'actions';
import { loadAlerts } from 'dispatchers';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class AlertsPaneViewModel extends StateAwareViewModel {
    constructor() {
        super();

        loadAlerts();
    }

    onState({ alerts }) {
        console.warn('HERE', alerts);
    }

    closeDrawer() {
        closeDrawer();
    }
}

export default {
    viewModel: AlertsPaneViewModel,
    template: template
};
