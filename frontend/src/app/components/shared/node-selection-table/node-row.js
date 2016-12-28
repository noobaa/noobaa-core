import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/all';

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
            () => {
                if (node()) {
                    if (!node().online) {
                        return stateIconMapping.offline;

                    } else if (node().decommissioning || node().decommissioned) {
                        return stateIconMapping.deactivated;

                    } else {
                        return stateIconMapping.online;
                    }
                } else {
                    return '';
                }
            }
        );

        this.name = ko.pureComputed(
            () => node() ? node().name : ''
        );

        this.ip = ko.pureComputed(
            () => node() ? node().ip : ''
        );

        this.capacity = ko.pureComputed(
            () => node() && node().storage && node().storage.total
        ).extend({
            formatSize: true
        });

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
