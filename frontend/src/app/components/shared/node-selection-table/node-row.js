import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize, deepFreeze } from 'utils';

const stateIconMapping = deepFreeze({
    true: {
        name: 'node-online',
        tooltip: 'online'
    },
    false: {
        name: 'node-offline',
        tooltip: 'offline'
    }
});

export default class NodeRowViewModel extends Disposable {
    constructor(node, selectedNodes) {
        super();

        this.selected = ko.pureComputed({
            read: () => selectedNodes().includes(this.name()),
            write: selected => selected ?
                selectedNodes.push(this.name()) :
                selectedNodes.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => node() && stateIconMapping[node().online]
        );

        this.name = ko.pureComputed(
            () => node() && node().name
        );

        this.ip = ko.pureComputed(
            () => node() && node().ip
        );

        this.capacity = ko.pureComputed(
            () => node() && (node().storage ? formatSize(node().storage.total) : 'N/A')
        );

        this.pool = ko.pureComputed(
            () => node() && {
                text:  node().pool,
                tooltip : node().pool
            }
        );

        this.recommended = '---';

        // this.recommended = ko.pureComputed(
        //     () => node() && (
        //         node().suggested_pool === ko.unwrap(currPoolName) ? 'yes' : '---'
        //     )
        // );
    }
}
