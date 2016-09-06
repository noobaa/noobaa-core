import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize, deepFreeze } from 'utils';

const stateIconMapping = deepFreeze({
    online: {
        tooltip: 'Online',
        css: 'success',
        name: 'healthy'
    },
    deactivated: {
        tooltip: 'Deactivated',
        css: 'warning',
        name: 'problem'
    },
    offline: {
        tooltip: 'Offline',
        css: 'error',
        name: 'problem'
    }
});

export default class NodeRowViewModel extends Disposable {
    constructor(node, selectedNodes , poolName) {
        super();

        this.selected = ko.pureComputed({
            read: () => selectedNodes().includes(this.name()),
            write: selected => selected ?
                selectedNodes.push(this.name()) :
                selectedNodes.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => node() ? stateIconMapping[(node().online ? (node().decommissioned || node().decommissioning ? 'deactivated' : 'online') : 'offline')] : ''
        );

        this.name = ko.pureComputed(
            () => node() ? node().name : ''
        );

        this.ip = ko.pureComputed(
            () => node() ? node().ip : ''
        );

        this.capacity = ko.pureComputed(
            () => (node() && node().storage) ? formatSize(node().storage.total) : 'N/A'
        );

        this.pool = ko.pureComputed(
            () =>  node() ? { text:  node().pool, tooltip : node().pool } : ''
        );

        this.recommended = ko.pureComputed(
            () => (node() && node().suggested_pool === ko.unwrap(poolName)) ?
                'yes' :
                '---'
        );
    }
}
