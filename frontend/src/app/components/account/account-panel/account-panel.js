import template from './account-panel.html';
import BaseViewModel from 'components/base-view-model';
import { uiState } from 'model';
import ko from 'knockout';

class AccountPanelViewModel extends BaseViewModel {
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
