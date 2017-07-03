/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';

class NsBucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.bucketName = ko.observable();

        this.observe(state$.get('location', 'params'), this.onLocationParams);
    }

    onLocationParams({ bucket, tab = 'data-placement' }) {
        this.bucketName(bucket);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        const bucket = this.bucketName();
        return {
            route: 'nsBucket',
            params: { bucket, tab }
        };
    }

    tabCss(tab) {
        const selected = this.selectedTab() === tab;
        return { selected };
    }
}

export default {
    viewModel: NsBucketPanelViewModel,
    template: template
};
