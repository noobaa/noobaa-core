import ko from 'knockout';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';

export default class ResourceRowViewModel {
    constructor({ onToggle }) {
        this.selected = ko.observable();
        this.state = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.target = ko.observable();

        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this.name(), val)
        });
    }

    onResource(resource, selectedResources) {
        const { name, target } = resource;

        this.state(getNamespaceResourceStateIcon(resource));
        this.type(getNamespaceResourceTypeIcon(resource));
        this.name(name);
        this.target(target);
        this._selected(selectedResources.includes(name));
    }
}
