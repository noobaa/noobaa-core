/* Copyright (C) 2016 NooBaa */

import template from './bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { loadBucketObjectList } from 'actions';

class BucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.bucket = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params, query }) {
        const { system, bucket, tab = 'data-placement' } = params;
        if (!bucket) return;

        this.baseRoute = realizeUri(route, { system, bucket }, {}, true);
        this.selectedTab(tab);
        this.bucket(bucket);

        if (tab === 'objects') {
            const { filter, sortBy = 'key', order = 1, page = 0 } = query;
            loadBucketObjectList(bucket, filter, sortBy, parseInt(order), parseInt(page));
        }
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
