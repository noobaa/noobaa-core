/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import  { realizeUri } from 'utils/browser-utils';

class NsBucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.bucketName = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocationParams({ route, params }) {
        const { system, tab = 'data-placement' } = params;

        this.baseRoute = realizeUri(route, { system }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: NsBucketPanelViewModel,
    template: template
};
