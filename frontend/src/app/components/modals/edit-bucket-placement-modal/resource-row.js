import ko from 'knockout';
import numeral from 'numeral';
import {
    getHostsPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

export default class ResourceRowViewModel {
    constructor({ onToggle }) {

        this._id = '';
        this.select = ko.observable();
        this.state = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.onlineHostCount = ko.observable();
        this.usage = ko.observable();

        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this._id, val)
        });
    }

    onResource(type, resource, selected) {
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
        const { name, storage, hostCount, hostsByMode } = pool;
        const onlineHostCount = numeral(hostCount - (hostsByMode.OFFLINE || 0)).format('0,0');
        const isSelected = selected.some(record => record.type === 'HOSTS' && record.name === name);

        this._id = { type: 'HOSTS', name };
        this._selected(isSelected);
        this.state(getHostsPoolStateIcon(pool));
        this.type('nodes-pool');
        this.name({ text: name, tooltip: name });
        this.onlineHostCount(onlineHostCount);
        this.usage({ total: storage.total, used: storage.used });
    }

    _onCloudResource(resource, selected) {
        const { name, storage } = resource;
        const isSelected = selected.some(record => record.type === 'CLOUD' && record.name === name);

        this._id = { type: 'CLOUD', name };
        this._selected(isSelected);
        this.state(getCloudResourceStateIcon(resource));
        this.type(getCloudResourceTypeIcon(resource));
        this.name({ text: name, tooltip: name });
        this.onlineHostCount('---');
        this.usage({ total: storage.total, used: storage.used });
    }

}
