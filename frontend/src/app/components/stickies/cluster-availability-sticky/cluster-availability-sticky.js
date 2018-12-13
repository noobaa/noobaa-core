/* Copyright (C) 2016 NooBaa */

import template from './cluster-availability-sticky.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class ClusterAvailabilityStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();

    selectState(state) {
        const { topology = {} } = state;
        return [
            topology.servers
        ];
    }

    mapStateToProps(servers) {
        if (!servers) {
            ko.assignToProps(this, {
                isActive: false
            });

        } else {
            const serverList = Object.values(servers);
            const connected = serverList
                .filter(server => server.mode === 'CONNECTED')
                .length;
            const isActive = connected < Math.floor(serverList.length / 2) + 1;

            ko.assignToProps(this, {
                isActive
            });
        }
    }
}

export default {
    viewModel: ClusterAvailabilityStickyViewModel,
    template: template
};
