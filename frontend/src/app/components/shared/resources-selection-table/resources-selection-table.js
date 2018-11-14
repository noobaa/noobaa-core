/* Copyright (C) 2016 NooBaa */

import template from './resources-selection-table.html';
import { deepFreeze, pick, noop } from 'utils/core-utils';
import {
    unassignedRegionText,
    getResourceId,
    getHostPoolStateIcon,
    getHostPoolHostsSummary,
    getHostPoolNodesSummary,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name'
    },
    {
        name: 'region'
    },
    {
        name: 'healthyHosts',
        label: 'Healthy Nodes'
    },
    {
        name: 'healthyNodes',
        label: 'Healthy Drives'
    },
    {
        name: 'usage',
        label: 'Used Capacity',
        type: 'capacity'
    }
]);

function _mapHostPoolToRow(id, pool, isDisabled, isSelected) {
    return {
        id,
        isDisabled,
        isSelected,
        state: getHostPoolStateIcon(pool),
        type: 'nodes-pool',
        name: {
            text: pool.name,
            tooltip: pool.name
        },
        region: pool.region || unassignedRegionText,
        healthyHosts: getHostPoolHostsSummary(pool),
        healthyNodes: getHostPoolNodesSummary(pool),
        usage: pick(pool.storage, ['total', 'used'])
    };
}

function _mapCloudResourceToRow(id, res, isDisabled, isSelected) {
    return {
        id,
        isDisabled,
        isSelected,
        state: getCloudResourceStateIcon(res),
        type: getCloudResourceTypeIcon(res),
        name: {
            text: res.name,
            tooltip: res.name
        },
        region: res.region || unassignedRegionText,
        healthyHosts: '---',
        healthyNodes: '---',
        usage: pick(res.storage, ['total', 'used'])
    };
}

class RowViewModel {
    id = '';
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    region = ko.observable();
    healthyHosts = ko.observable();
    healthyNodes = ko.observable();
    usage = ko.observable();
    isDisabled = ko.observable();
    isSelected = ko.observable();

    // This pure computed is used to bound the checkbox column.
    selected = ko.pureComputed({
        read: this.isSelected,
        write: this.onToggle,
        owner: this
    });

    constructor({ table }) {
        this.table = table;
    }

    onToggle(selected) {
        this.table.onToggleResource(this.id, selected);
    }
}

class ResourcesSelectionTableViewModel {
    dataReady = ko.observable();
    sub = null;
    onSelect = noop;
    columns = columns;
    title = ko.observable();
    selected = [];
    disabled = [];
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this })

    constructor(params) {
        if (ko.isWritableObservable(params.selected)) {
            this.onSelect = val => params.selected(val);
        }

        this.sub = ko.computed(() => this.mapParamsToProps(
            ko.unwrap(params.title),
            ko.unwrap(params.hostPools),
            ko.unwrap(params.cloudResources),
            ko.unwrap(params.disabled || []),
            ko.unwrap(params.selected)
        ));
    }

    mapParamsToProps(
        title,
        hostPools,
        cloudResources,
        disabled,
        selected
    ) {
        if (!hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const hostPoolRows = Object.values(hostPools).map(pool => {
                const id = getResourceId('HOSTS', pool.name);
                const isDisabled = disabled.includes(id);
                const isSelected = selected.includes(id);
                return _mapHostPoolToRow(id, pool, isDisabled, isSelected);
            });

            const cloudResourceRows = Object.values(cloudResources).map(res => {
                const id = getResourceId('CLOUD', res.name);
                const isDisabled = disabled.includes(id);
                const isSelected = selected.includes(id);
                return _mapCloudResourceToRow(id, res, isDisabled, isSelected);
            });

            ko.assignToProps(this, {
                dataReady: true,
                title,
                selected,
                disabled,
                rows: [
                    ...hostPoolRows,
                    ...cloudResourceRows
                ]
            });
        }
    }

    onToggleResource(resId, selected) {
        if (selected) {
            const ids = [...this.selected, resId];
            this.onSelect(ids);

        } else {
            const ids = this.selected
                .filter(id => id !== resId);

            this.onSelect(ids);
        }
    }

    onSelectAll() {
        const ids = this.rows()
            .map(row => row.id)
            .filter(id => !this.disabled.includes(id));

        this.onSelect(ids);
    }

    onClearAll() {
        this.onSelect([]);
    }

    dispose() {
        this.sub.dispose();
    }
}

export default {
    viewModel: ResourcesSelectionTableViewModel,
    template: template
};
