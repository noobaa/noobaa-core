import template from './account-panel.html';
import Disposable from 'disposable';
import { uiState } from 'model';
import ko from 'knockout';

class AccountPanelViewModel extends Disposable{
    constructor() {
        super();

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );

    }

    tabHref(tab) {
        return {
            route: 'account',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: this.selectedTab() === tab
        };
    }
}

export default {
    viewModel: AccountPanelViewModel,
    template: template
};
