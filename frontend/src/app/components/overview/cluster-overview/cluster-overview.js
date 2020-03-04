/* Copyright (C) 2016 NooBaa */

import template from './cluster-overview.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getClusterStateIcon } from 'utils/cluster-utils';

class ClusterOverviewViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    clusterIcon = ko.observable();
    clusterState = ko.observable();

    selectState(state) {
        const { system, topology } = state;
        return [
            topology,
            system
        ];
    }

    mapStateToProps(topology, system) {
        if (!system) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            const { tooltip: clusterState, ...clusterIcon } = getClusterStateIcon(topology, system.version);

            ko.assignToProps(this, {
                dataReady: true,
                clusterIcon,
                clusterState
            });
        }
    }
}

export default {
    viewModel: ClusterOverviewViewModel,
    template: template
};
