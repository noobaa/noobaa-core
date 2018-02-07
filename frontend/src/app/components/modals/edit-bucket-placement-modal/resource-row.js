import ko from 'knockout';
import numeral from 'numeral';
import {
    getHostsPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

export default class ResourceRowViewModel {
    _id = '';
    select = ko.observable();
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    onlineHostCount = ko.observable();
    usage = ko.observable();
    disabledCss = ko.observable();
    tooltip = ko.observable();

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

    onResource(type, resource, selected, spilloverResource) {
        const disabled = spilloverResource === resource.name;
        const tooltip = disabled ? 'Resource is already used for bucket spillover' : '';
        const disabledCss = disabled ? 'disabled-row' : '';

        this.disabledCss(disabledCss);
        this.tooltip(tooltip);
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
        const state = getHostsPoolStateIcon(pool);


        this._id = { type: 'HOSTS', name };
        this._selected(isSelected);
        this.state(state);
        this.type('nodes-pool');
        this.name({ text: name, tooltip: name });
        this.onlineHostCount(onlineHostCount);
        this.usage({ total: storage.total, used: storage.used });
    }

    _onCloudResource(resource, selected) {
        const { name, storage } = resource;
        const isSelected = selected.some(record => record.type === 'CLOUD' && record.name === name);
        const state = getCloudResourceStateIcon(resource);

        this._id = { type: 'CLOUD', name };
        this._selected(isSelected);
        this.state(state);
        this.type(getCloudResourceTypeIcon(resource));
        this.name({ text: name, tooltip: name });
        this.onlineHostCount('---');
        this.usage({ total: storage.total, used: storage.used });
    }

}
