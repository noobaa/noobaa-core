import template from './overview-panel.html';
import BaseViewModel from 'base-view-model';

class OverviewPanelViewModel extends BaseViewModel {
    constructor() {
        super();
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
