import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize } from 'utils';

export default class PoolRowViewModel extends Disposable {
    constructor(pool, selectedPools) {
        super();

        this.select = ko.pureComputed({
            read: () => selectedPools().includes(this.name()),
            write: val => val ?
                selectedPools.push(this.name()) :
                selectedPools.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return;
                }

                let { count, has_issues } = pool().nodes;
                let state = count - has_issues >= 3;
                return {
                    css: state ? 'success' : 'error',
                    name: state ? 'healthy' : 'problem',
                    tooltip: state ? 'healthy' : 'not enough healthy nodes'
                };
            }
        );


        this.name = ko.pureComputed(
            () => pool() ? pool().name : ''
        );

        this.onlineCount = ko.pureComputed(
            () => pool() && pool().nodes.online
        ).extend({
            formatNumber: true
        });

        this.freeSpace = ko.pureComputed(
            () => pool() && pool().storage.free
        ).extend({
            formatSize: true
        });
    }
}
