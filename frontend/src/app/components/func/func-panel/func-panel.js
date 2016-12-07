import template from './func-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { funcInfo, uiState, routeContext } from 'model';

class FuncPanelViewModel extends Disposable {
    constructor() {
        super();

        this.func = funcInfo;

        this.ready = ko.pureComputed(
            () => funcInfo() && funcInfo().config.name === routeContext().params.func
        );

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    tabHref(tab) {
        return { route: 'func', params: { tab } };
    }

    tabCss(tab) {
        return { selected: this.selectedTab() === tab };
    }
}

export default {
    viewModel: FuncPanelViewModel,
    template: template
};
