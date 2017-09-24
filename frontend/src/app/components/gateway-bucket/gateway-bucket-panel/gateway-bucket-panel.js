/* Copyright (C) 2016 NooBaa */

import template from './gateway-bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import  { realizeUri } from 'utils/browser-utils';

class GatewayBucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.bucketName = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation(location) {
        const { system, bucket, tab = 'data-placement' } = location.params;

        this.bucketName(bucket);
        this.baseRoute = realizeUri(location.route, { system, bucket }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: GatewayBucketPanelViewModel,
    template: template
};
