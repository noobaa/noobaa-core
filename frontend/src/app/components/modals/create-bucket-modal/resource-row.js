/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { sumBy } from 'utils/core-utils';
import { hostWritableModes, storageNodeWritableModes } from 'utils/host-utils';
import {
    unassignedRegionText,
    getHostPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

function _formatCounts(some, all) {
    return `${
        numeral(some).format('0,0')
    } of ${
        numeral(all).format('0,0')
    }`;
}

export default class ResourceRowViewModel {
    _id = '';
    select = ko.observable();
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    region = ko.observable();
    healthyHosts = ko.observable();
    healthyNodes = ko.observable();
    usage = ko.observable();

    constructor({ onToggle }) {
        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this._id, val)
        });
    }

    onState(type, resource, selected) {
        switch (type) {
            case 'HOSTS': {
                this._onHostPool(resource, selected);
                break;
            }

            case 'CLOUD': {
                this._onCloudResource(resource, selected);
                break;
            }
        }
    }

    _onHostPool(pool, selected) {
        const {
            name,
            region = unassignedRegionText,
            storage,
            hostCount,
            hostsByMode,
            storageNodeCount,
            storageNodesByMode
        } = pool;
        const isSelected = selected.some(record => record.type === 'HOSTS' && record.name === name);
        const state = getHostPoolStateIcon(pool);
        const healthyHosts = sumBy(
            hostWritableModes,
            mode => hostsByMode[mode] || 0
        );
        const healthyNodes = sumBy(
            storageNodeWritableModes,
            mode => storageNodesByMode[mode] || 0
        );

        this._id = { type: 'HOSTS', name };
        this._selected(isSelected);
        this.state(state);
        this.type({ name: 'nodes-pool', tooltip: 'Nodes Pool' });
        this.name({ text: name, tooltip: name });
        this.region(region);
        this.healthyHosts(_formatCounts(healthyHosts, hostCount));
        this.healthyNodes(_formatCounts(healthyNodes, storageNodeCount));
        this.usage({ total: storage.total, used: storage.used });
    }

    _onCloudResource(resource, selected) {
        const { name, region = unassignedRegionText, storage } = resource;
        const isSelected = selected.some(record => record.type === 'CLOUD' && record.name === name);
        const state = getCloudResourceStateIcon(resource);

        this._id = { type: 'CLOUD', name };
        this._selected(isSelected);
        this.state(state);
        this.type(getCloudResourceTypeIcon(resource));
        this.name({ text: name, tooltip: name });
        this.region(region);
        this.healthyHosts('---');
        this.healthyNodes('---');
        this.usage({ total: storage.total, used: storage.used });
    }

}
