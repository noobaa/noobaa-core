/* Copyright (C) 2016 NooBaa */

import template from './host-storage-form.html';
import Observer from 'observer';
import StorageNodeRowViewModel from './storage-node-row';
import { state$, action$ } from 'state';
import { openEditHostStorageDrivesModal } from 'action-creators';
import { paginationPageSize } from 'config';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { getStorageServiceStateIcon } from 'utils/host-utils';
import { toBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';

const operationsDisabledTooltip = deepFreeze({
    align: 'end',
    text: 'This operation is not available during node’s deletion'
});

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: node => node.mode === 'DECOMMISSIONED' ? String.fromCodePoint(9999) : node.mode
    },
    {
        name: 'mount',
        sortable: true,
        compareKey: node => node.mount
    },
    {
        name: 'readLatency',
        sortable: true,
        compareKey: node => node.readLatency
    },
    {
        name: 'writeLatency',
        sortable: true,
        compareKey: node => node.writeLatency
    },
    {
        name: 'capacity',
        label: 'Used Capacity',
        type: 'capacity',
        sortable: true,
        compareKey: node => toBytes(node.storage.total || 0)
    },
    {
        name: 'dataActivity',
        sortable: true,
        compareKey: node => node.activity
    }
]);

class HostStorageFormViewModel extends Observer {
    hostName = '';
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    itemCount = ko.observable();
    hostLoaded = ko.observable();
    driveCount = ko.observable();
    page = ko.observable();
    sorting = ko.observable();
    mode = ko.observable();
    os = ko.observable();
    isEditDrivesDisabled = ko.observable();
    editDrivesTooltip = ko.observable();
    rows = ko.observableArray();

    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);

        this.observe(
            state$.getMany(
                ['hosts', 'items', this.hostName],
                'location'
            ),
            this.onHost
        );
    }

    onHost([host, location]) {
        if (!host) {
            this.isEditDrivesDisabled(true);
            return;
        }

        const { nodes } = host.services.storage;
        const enabledNodesCount = nodes.filter(node => node.mode !== 'DECOMMISSIONED').length;
        const isHostBeingDeleted = host.mode === 'DELETING';
        const editDrivesTooltip = isHostBeingDeleted ? operationsDisabledTooltip : '';
        const page = Number(location.query.page) || 0;
        const order = Number(location.query.order) || 1;
        const sortBy = location.query.sortBy || 'state';
        const pageStart = page * this.pageSize;
        const { compareKey } = this.columns.find(column => column.name === sortBy);

        const rows =  Array.from(nodes)
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((node, i) => {
                const row = this.rows.get(i) || new StorageNodeRowViewModel();
                row.onNode(node);
                return row;
            });

        this.pathname = location.pathname;
        this.page(page);
        this.sorting({ sortBy, order });
        this.mode(getStorageServiceStateIcon(host));
        this.driveCount(`${enabledNodesCount} of ${nodes.length}`);
        this.itemCount(nodes.length);
        this.os(host.os);
        this.isEditDrivesDisabled(isHostBeingDeleted);
        this.editDrivesTooltip(editDrivesTooltip);
        this.rows(rows);
        this.hostLoaded(true);
    }

    onSort(sorting) {
        this._query({
            sorting,
            page: 0
        });
    }

    onPage(page) {
        this._query({
            page
        });
    }

    _query(params) {
        const {
            sorting = this.sorting(),
            page = this.page()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            sortBy: sortBy,
            order: order,
            page: page || undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onEditDrives() {
        action$.onNext(openEditHostStorageDrivesModal(this.hostName));
    }
}

export default {
    viewModel: HostStorageFormViewModel,
    template: template
};
