import template from './resources-panel.html';
import ko from 'knockout';
import { uiState } from 'model';

class PoolsPanelViewModel {
    constructor() {
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
