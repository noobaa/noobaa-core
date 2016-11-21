import template from './func-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { funcInfo, uiState, routeContext } from 'model';

class FuncPanelViewModel extends Disposable {
    constructor() {
        super();

        this.func = ko.pureComputed(
            () => funcInfo()
        );

        this.ready = ko.pureComputed(
            () => this.func() && this.func().config.name === routeContext().params.func
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
