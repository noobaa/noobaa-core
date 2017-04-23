/* Copyright (C) 2016 NooBaa */

import template from './resources-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { uiState } from 'model';

class PoolsPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isCreatePoolWizardVisible = ko.observable(false);
    }

    tabHref(tab) {
        return {
            route: 'pools',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: uiState().tab === tab
        };
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
