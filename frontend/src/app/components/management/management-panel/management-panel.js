import template from './management-panel.html';
import ko from 'knockout';
import { uiState } from 'model';

class ManagementPanelViewModel {
    constructor() {
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
}