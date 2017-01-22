import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { getNodeStateIcon, getNodeCapacityBarValues } from 'utils/ui-utils';

export default class NodeRowViewModel extends BaseViewModel {
    constructor(node, selectedNodes , poolName) {
        super();

        this.selected = ko.pureComputed({
            read: () => selectedNodes().includes(this.name()),
            write: selected => selected ?
                selectedNodes.push(this.name()) :
                selectedNodes.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => node() ? getNodeStateIcon(node()) : ''
        );

        this.name = ko.pureComputed(
            () => node() ? node().name : ''
        );

        this.ip = ko.pureComputed(
            () => node() ? node().ip : ''
        );

        this.capacity = ko.pureComputed(
            () => getNodeCapacityBarValues(node() || {})
        );

        this.pool = ko.pureComputed(
            () => node() ? { text:  node().pool, tooltip : node().pool } : ''
        );

        this.recommended = ko.pureComputed(
            () => (node() && node().suggested_pool === ko.unwrap(poolName)) ?
                'yes' :
                '---'
        );
    }
}
