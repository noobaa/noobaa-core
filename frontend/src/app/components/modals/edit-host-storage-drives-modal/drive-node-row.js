import { getNodeOrHostCapacityBarValues } from 'utils/host-utils';
import ko from 'knockout';

export default class DriveNodeRowViewModel {
    constructor({ onToggle }) {
        this.name = '';
        this._selected = ko.observable();
        this.mount = ko.observable();
        this.capacity = ko.observable();
        this.disabled = ko.observable();
        this.rowCss = ko.observable();

        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this.name, val)
        });
    }

    onNode(node, isSelected) {
        const { name, mount } = node;

        this.name = name;
        this.mount(mount);
        this.capacity(getNodeOrHostCapacityBarValues(node));
        this._selected(isSelected);
    }
}
