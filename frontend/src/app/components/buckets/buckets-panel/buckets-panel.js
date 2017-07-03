/* Copyright (C) 2016 NooBaa */

import template from './buckets-panel.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';

class BucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();

        this.observe(
            state$.get('location', 'params', 'tab'),
            this.onTab
        );
    }

    onTab(tab = 'data-buckets') {
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return {
            route: 'buckets',
            params: { tab }
        };
    }
}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
