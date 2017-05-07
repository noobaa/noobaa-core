/* Copyright (C) 2016 NooBaa */

import template from './func-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { funcInfo, uiState } from 'model';

class FuncPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.func = funcInfo;

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
