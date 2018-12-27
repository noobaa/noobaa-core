/* Copyright (C) 2016 NooBaa */

import template from './host-storage-form.html';
import ConnectableViewModel from 'components/connectable';
import { openEditHostStorageDrivesModal } from 'action-creators';
import { paginationPageSize } from 'config';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';
import {
    getStorageServiceStateIcon,
    getActivityName,
    getActivityStageName,
    getStorageNodeStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';

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

function _getActivityString(activity) {
    if (!activity) return 'No activity';

    const { kind, progress, stage } = activity;
    const name = getActivityName(kind);
    const percentage = numeral(progress).format('%');
    const stageName = getActivityStageName(stage);
    return `${name} (${percentage}) | ${stageName}`;
}

function _formatLatencyValue(latency) {
    const format = true &&
        (latency > 99 && '0,0') ||
        (latency > 9 && '0.0') ||
        '0.00';

    return numeral(latency).format(format);
}

function _mapNodeToRow(node) {
    const { mode, mount, readLatency, writeLatency, activity } = node;
    return {
        state: getStorageNodeStateIcon(node),
        mount,
        readLatency: `${_formatLatencyValue(readLatency)} ms`,
        writeLatency: `${_formatLatencyValue(writeLatency)} ms`,
        dataActivity: _getActivityString(activity),
        capacity: getNodeOrHostCapacityBarValues(node),
        isDisabled: mode === 'DECOMMISSIONED'
    };
}

class StorageNodeRowViewModel {
    state = ko.observable();
    mount = ko.observable();
    readLatency = ko.observable();
    writeLatency = ko.observable();
    capacity = ko.observable();
    dataActivity = ko.observable();
    isDisabled = ko.observable();
}

class HostStorageFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    hostName = '';
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    itemCount = ko.observable();
    driveCount = ko.observable();
    page = ko.observable();
    sorting = ko.observable();
    mode = ko.observable();
    os = ko.observable();
    isEditDrivesDisabled = ko.observable();
    editDrivesTooltip = ko.observable();
    rows = ko.observableArray()
        .ofType(StorageNodeRowViewModel);

    selectState(state, params) {
        const { hosts, location } = state;
        return [
            params.name,
            hosts && hosts.items[params.name],
            location
        ];
    }

    mapStateToProps(hostName, host, location) {
        if (!host) {
            ko.assignToProps(this, {
                hostName,
                dataReady: false,
                isEditDrivesDisabled: true
            });

        } else {
            const { nodes } = host.services.storage;
            const enabledNodesCount = nodes.filter(node => node.mode !== 'DECOMMISSIONED').length;
            const isHostBeingDeleted = host.mode === 'DELETING';
            const editDrivesTooltip = isHostBeingDeleted ? operationsDisabledTooltip : '';
            const { pathname, query } = location;
            const page = Number(query.page) || 0;
            const order = Number(query.order) || 1;
            const sortBy = query.sortBy || 'state';
            const pageStart = page * this.pageSize;
            const { compareKey } = this.columns.find(column => column.name === sortBy);

            ko.assignToProps(this, {
                dataReady: true,
                hostName,
                pathname,
                page,
                sorting: { sortBy, order },
                mode: getStorageServiceStateIcon(host),
                driveCount: `${enabledNodesCount} of ${nodes.length}`,
                itemCount: nodes.length,
                os: host.os,
                isEditDrivesDisabled: isHostBeingDeleted,
                editDrivesTooltip,
                rows: Array.from(nodes)
                    .sort(createCompareFunc(compareKey, order))
                    .slice(pageStart, pageStart + this.pageSize)
                    .map(_mapNodeToRow)
            });
        }
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

        this.dispatch(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onEditDrives() {
        this.dispatch(openEditHostStorageDrivesModal(this.hostName));
    }
}

export default {
    viewModel: HostStorageFormViewModel,
    template: template
};
