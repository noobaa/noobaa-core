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

                let state = this.onlineCount() >= 3;
                return {
                    name: `pool-${state ? 'healthy' : 'problem'}`,
                    tooltip: state ? 'healthy' : 'problem'
                };
            }
        );


        this.name = ko.pureComputed(
            () => pool() ? pool().name : ''
        );

        this.onlineCount = ko.pureComputed(
            () => pool() ? pool().nodes.online : ''
        );

        this.freeSpace = ko.pureComputed(
            () => pool() ? formatSize(pool().storage.free) : ''
        );
    }
}
