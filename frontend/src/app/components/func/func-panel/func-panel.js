import template from './func-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { funcFunction, uiState } from 'model';

class FuncPanelViewModel extends Disposable {
    constructor() {
        super();

        this.func = ko.pureComputed(
            () => funcFunction()
        );

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(tabName) {
        return this.selectedTab() === tabName;
    }
}

export default {
    viewModel: FuncPanelViewModel,
    template: template
};
