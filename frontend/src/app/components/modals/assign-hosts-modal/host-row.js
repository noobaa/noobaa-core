/* Copyright (C) 2016 NooBaa */

// import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import {
    getHostDisplayName,
    getHostStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';

export default class HostRowViewModel {
    constructor({ onToggle }) {
        this.name;
        this.displayName = ko.observable();
        this.selected = ko.observable();
        this.state = ko.observable();
        this.ip = ko.observable();
        this.capacity = ko.observable();
        this.pool = ko.observable();
        this.recommended = ko.observable();

        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this.name, val)
        });
    }

    onHost(host, selectedHosts, recommendationPool) {
        const { name, ip, pool, suggestedPool } = host;

        this.name = name;
        this.displayName(getHostDisplayName(name));
        this.state(getHostStateIcon(host));
        this.ip(ip);
        this.capacity(getNodeOrHostCapacityBarValues(host));
        this.pool({ text: pool, tooltip: pool });
        this.recommended(suggestedPool === recommendationPool ? 'yes' : '---');
        this._selected(selectedHosts.includes(name));
    }
}
