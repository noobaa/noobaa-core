/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import  { realizeUri } from 'utils/browser-utils';

class NamespaceBucketPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();
    bucketName = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { system, bucket, tab = 'data-placement' } = location.params;

        ko.assignToProps(this, {
            bucketName: bucket,
            baseRoute: realizeUri(location.route, { system, bucket }, {}, true),
            selectedTab: tab
        });
    }

    tabHref(tab) {
        const route = this.baseRoute();
        return route ? realizeUri(route, { tab }) : '';
    }
}

export default {
    viewModel: NamespaceBucketPanelViewModel,
    template: template
};
