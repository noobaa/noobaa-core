/* Copyright (C) 2016 NooBaa */

import template from './cluster-availability-sticky.html';
import ko from 'knockout';
import { systemInfo } from 'model';

class ClusterAvailabilityStickyViewModel {
    constructor() {
        this.isActive = ko.pureComputed(
            () => {
                if (!systemInfo()) return;

                const { servers } = systemInfo().cluster.shards[0];
                const connected = servers
                    .filter(server => server.status === 'CONNECTED')
                    .length;

                return connected < Math.floor(servers.length / 2) + 1;
            }
        );
    }
}

export default {
    viewModel: ClusterAvailabilityStickyViewModel,
    template: template
};
