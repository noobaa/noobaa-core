import template from './management-panel.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { uiState } from 'model';

class ManagementPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(tab) {
        return this.selectedTab() === tab;
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
