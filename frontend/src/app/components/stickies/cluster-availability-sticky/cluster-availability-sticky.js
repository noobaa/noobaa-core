/* Copyright (C) 2016 NooBaa */

import template from './cluster-availability-sticky.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';

class ClusterAvailabilityStickyViewModel extends Observer {
    isActive = ko.observable();

    constructor() {
        super();

        this.observe(state$.get('topology', 'servers'), this.onState);
    }

    onState(servers) {
        if (!servers) {
            this.isActive(false);
            return;
        }

        const serverList = Object.values(servers);
        const connected = serverList
            .filter(server => server.mode === 'CONNECTED')
            .length;
        const isActive = connected < Math.floor(serverList.length / 2) + 1;

        this.isActive(isActive);
    }
}

export default {
    viewModel: ClusterAvailabilityStickyViewModel,
    template: template
};
