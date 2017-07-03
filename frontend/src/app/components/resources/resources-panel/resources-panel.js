/* Copyright (C) 2016 NooBaa */

import template from './resources-panel.html';
import Observer  from 'observer';
import { state$ } from 'state';
import ko from 'knockout';


class PoolsPanelViewModel extends Observer  {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.isCreatePoolWizardVisible = ko.observable(false);

        this.observe(
            state$.get('location', 'params', 'tab'),
            this.onTab
        );
    }

    onTab(tab = 'pools') {
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return {
            route: 'pools',
            params: { tab }
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
