/* Copyright (C) 2016 NooBaa */

import template from './bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { get } from 'rx-extensions';
import { realizeUri } from 'utils/browser-utils';

class BucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.bucket = ko.observable();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation({ route, params }) {
        const { system, bucket, tab = 'data-placement' } = params;
        if (!bucket) return;

        this.baseRoute = realizeUri(route, { system, bucket }, {}, true);
        this.selectedTab(tab);
        this.bucket(bucket);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
