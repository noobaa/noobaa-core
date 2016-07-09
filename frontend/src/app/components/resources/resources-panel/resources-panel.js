import template from './resources-panel.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { uiState } from 'model';

class PoolsPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isCreatePoolWizardVisible = ko.observable(false);

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(tabName) {
        return this.selectedTab() === tabName;
    }

    showCreatePoolWizard() {
        this.isCreatePoolWizardVisible(true);
    }

    hideCreatePoolWizard() {
        this.isCreatePoolWizardVisible(false);
    }
}

export default {
    viewModel: PoolsPanelViewModel,
    template: template
};
