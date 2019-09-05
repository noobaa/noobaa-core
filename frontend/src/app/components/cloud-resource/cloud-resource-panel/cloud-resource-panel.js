/* Copyright (C) 2016 NooBaa */

import template from './cloud-resource-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { paginationPageSize } from 'config';
import { fetchCloudResourceObjects } from 'action-creators';

class CloudResourcePanelViewModel extends ConnectableViewModel {
    route = ko.observable('');
    resource = ko.observable();
    selectedTab = ko.observable();
    hostName = ko.observable();
    page = -1;
    pageSize = -1;

    selectState(state) {
        const { cloudResources = {}, location } = state;
        const { resource: name } = location.params;
        const resource = cloudResources[name];

        return [
            location,
            resource && resource.internalHost
        ];
    }

    onState(state, params) {
        super.onState(state, params);
        this.fetchParts(state.location);
    }

    mapStateToProps(location, resourceHost) {
        const { system, resource, tab = 'properties' } = location.params;

        ko.assignToProps(this, {
            route: realizeUri(location.route, { system, resource }, {}, true),
            resource: resource,
            selectedTab: tab,
            hostName: resourceHost
        });
    }

    fetchParts(location) {
        if (location.params.tab !== 'parts') {
            return;
        }

        const page = Number(location.query.page) || 0;
        const pageSize = Number(location.query.pageSize) || paginationPageSize.default;
        if (this.page === page && this.pageSize === pageSize) {
            return;
        }

        this.page = page;
        this.dispatch(fetchCloudResourceObjects(
            location.params.resource,
            page * pageSize,
            pageSize
        ));
    }

    tabHref(tab) {
        return realizeUri(this.route(), { tab });
    }
}

export default {
    viewModel: CloudResourcePanelViewModel,
    template: template
};
