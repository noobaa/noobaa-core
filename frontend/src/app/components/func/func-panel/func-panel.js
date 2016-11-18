import template from './func-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { funcInfo, uiState } from 'model';

class FuncPanelViewModel extends Disposable {
    constructor() {
        super();

        this.func = ko.pureComputed(
            () => funcInfo()
        );

        this.ready = ko.pureComputed(
            () => !!this.func()
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
