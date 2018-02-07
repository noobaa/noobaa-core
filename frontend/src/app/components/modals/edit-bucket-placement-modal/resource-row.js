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
        this.selected = ko.observable();
        this._isSelected = ko.observable();
        this.isSelected = ko.pureComputed({
            read: this._isSelected,
            write: val => onToggle(this._id, val)
        });
    }

    onResource(type, resource, selected, spillover) {
        const disabled = spillover && spillover.name === resource.name;
        const tooltip = disabled ? 'Resource is already used for bucket spillover' : resource.name;
        const selectedInfo = {
            isSelected: this.isSelected,
            disabled
        };

        this.selected(selectedInfo);

        switch (type) {
            case 'HOSTS': {
                this._onHostPool(resource, selected, disabled, tooltip);
                break;
            }

            case 'CLOUD': {
                this._onCloudResource(resource, selected, disabled, tooltip);
                break;
            }
        }
    }

    _onHostPool(pool, selected, disabled, tooltip) {
        const { name, storage, hostCount, hostsByMode } = pool;
        const onlineHostCount = numeral(hostCount - (hostsByMode.OFFLINE || 0)).format('0,0');
        const isSelected = selected.some(record => record.type === 'HOSTS' && record.name === name);
        const stateIcon = getHostsPoolStateIcon(pool);
        const state = {
            ...stateIcon,
            css: disabled ? '' : stateIcon.css
        };

        this._id = { type: 'HOSTS', name };
        this._isSelected(isSelected);
        this.state(state);
        this.type('nodes-pool');
        this.name({ text: name, tooltip });
        this.onlineHostCount(onlineHostCount);
        this.usage({ total: storage.total, used: storage.used });
    }

    _onCloudResource(resource, selected, disabled, tooltip) {
        const { name, storage } = resource;
        const isSelected = selected.some(record => record.type === 'CLOUD' && record.name === name);
        const stateIcon = getCloudResourceStateIcon(resource);
        const state = {
            ...stateIcon,
            css: disabled ? '' : stateIcon.css
        };

        this._id = { type: 'CLOUD', name };
        this._isSelected(isSelected);
        this.state(state);
        this.type(getCloudResourceTypeIcon(resource));
        this.name({ text: name, tooltip });
        this.onlineHostCount('---');
        this.usage({ total: storage.total, used: storage.used });
    }

}
