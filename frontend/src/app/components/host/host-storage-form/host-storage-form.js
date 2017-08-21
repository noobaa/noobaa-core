/* Copyright (C) 2016 NooBaa */

import template from './host-storage-form.html';
import Observer from 'observer';
import StorageNodeRowViewModel from './storage-node-row';
import { state$, action$ } from 'state';
import { openEditHostStorageDrivesModal } from 'action-creators';
import ko from 'knockout';
import { deepFreeze, compare } from 'utils/core-utils';
import { getStorageServiceStateIcon } from 'utils/host-utils';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'mount'
    },
    {
        name: 'readLatency'
    },
    {
        name: 'writeLatency'
    },
    {
        name: 'capacity',
        label: 'Used Capacity',
        type: 'capacity'
    },
    {
        name: 'dataActivity'
    }
]);

function _compareNodes(node1, node2) {
    if (node1.mode === node2.mode) {
        return 0;
    } if (node1.mode === 'DECOMMISSIONED') {
        return 1;
    } else if (node2.mode === 'DECOMMISSIONED'){
        return -1;
    } else {
        return compare(node1.mode, node2.mode);
    }
}

class HostStorageFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);
        this.columns = columns;
        this.hostLoaded = ko.observable(false);
        this.driveCount = ko.observable('');
        this.mode = ko.observable('');
        this.os = ko.observable('');
        this.rows = ko.observableArray();

        this.observe(state$.get('hosts', 'items', this.hostName), this.onHost);
    }

    onHost(host) {
        if (!host) return;

        const { nodes } = host.services.storage;
        const enabledNodesCount = nodes.filter(node => node.mode !== 'DECOMMISSIONED').length;
        const rows = Array.from(nodes)
            .sort(_compareNodes)
            .map((node, i) => {
                const row = this.rows.get(i) || new StorageNodeRowViewModel();
                row.onNode(node);
                return row;
            });

        this.mode(getStorageServiceStateIcon(host));
        this.os(host.os);
        this.driveCount(`${enabledNodesCount} of ${nodes.length}`);
        this.rows(rows);
        this.hostLoaded(true);
    }

    onEditDrives() {
        action$.onNext(openEditHostStorageDrivesModal(this.hostName));
    }
}

export default {
    viewModel: HostStorageFormViewModel,
    template: template
};
