/* Copyright (C) 2016 NooBaa */

import template from './cluster-overview.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getClusterStateIcon, getClsuterHAState } from 'utils/cluster-utils';
import * as routes from 'routes';

function _getServerCount(servers) {
    return servers ?
        `Contains ${stringifyAmount('server', Object.keys(servers).length)}` :
        '';
}

class ClusterOverviewViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    clusterServerCount = ko.observable();
    clusterIcon = ko.observable();
    clusterHref = ko.observable();
    clusterState = ko.observable();
    clusterHA = ko.observable();

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
            const clusterHA = getClsuterHAState(topology);
            const clusterHref = realizeUri(routes.cluster, { system: system.name });

            ko.assignToProps(this, {
                dataReady: true,
                clusterServerCount: _getServerCount(topology.servers),
                clusterIcon,
                clusterState,
                clusterHA,
                clusterHref
            });
        }
    }
}

export default {
    viewModel: ClusterOverviewViewModel,
    template: template
};
