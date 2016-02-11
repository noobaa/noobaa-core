import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils';
import { deletePool } from 'actions';

let defaultPoolName = 'default_pool';

export default class PoolRowViewModel {
    constructor(pool, deleteCandidate) {
        this.isVisible = ko.pureComputed(
            () => !!pool()
        );

        this.stateIcon = '/fe/assets/icons.svg#pool';

        this.name = ko.pureComputed(
            () => pool() && pool().name
        );

        this.href = ko.pureComputed(
            () => pool() && `/fe/systems/:system/pools/${pool().name}`
        );

        this.nodeCount = ko.pureComputed(
            () => pool() && numeral(pool().nodes.count).format('0,0')
        );

        this.onlineCount = ko.pureComputed(
            () => pool() && numeral(pool().nodes.online).format('0,0')
        );

        this.offlineCount = ko.pureComputed(
            () => pool() && numeral(this.nodeCount() - this.onlineCount()).format('0,0')
        );

        this.usage = ko.pureComputed(
            () => pool() && (pool().storage ? formatSize(pool().storage.used) : 'N/A')
        );

        this.capacity = ko.pureComputed(
            () => pool() && (pool().storage ? formatSize(pool().storage.total) : 'N/A')
        );

        let hasNodes = ko.pureComputed(
            () => pool() && pool().nodes.count > 0
        );

        let isDefaultPool = ko.pureComputed(
            () => this.name() === defaultPoolName
        )

        this.isDeletable = ko.pureComputed(
            () => !isDefaultPool() && !hasNodes()
        );

        this.deleteToolTip = ko.pureComputed( 
            () => isDefaultPool() ? 
                'cannot delete default pool' :
                (hasNodes() ? 'pool has nodes' : 'delete pool')
        );
    }

    del() {
        deletePool(this.name());
    }    
}