import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils';
import { deletePool } from 'actions';

export default class PoolRowViewModel {
    constructor(pool, deleteCandidate) {
        this.isVisible = ko.pureComputed(
            () => !!pool()
        );

        this.stateIcon = '/fe/assets/icons.svg#pool';

        this.name = ko.pureComputed(
            () => this.isVisible() && pool().name
        );

        this.href = ko.pureComputed(
            () => this.isVisible() && `/fe/systems/:system/pools/${pool().name}`
        );

        this.nodeCount = ko.pureComputed(
            () => this.isVisible() && numeral(pool().nodes.count).format('0,0')
        );

        this.onlineCount = ko.pureComputed(
            () => this.isVisible() && numeral(pool().nodes.online).format('0,0')
        );

        this.offlineCount = ko.pureComputed(
            () => this.isVisible() && numeral(this.nodeCount() - this.onlineCount()).format('0,0')
        );

        this.usage = ko.pureComputed(
            () => this.isVisible() && (pool().storage ? formatSize(pool().storage.used) : 'N/A')
        );

        this.capacity = ko.pureComputed(
            () => this.isVisible() && (pool().storage ? formatSize(pool().storage.total) : 'N/A')
        );

        this.isDeletable = ko.pureComputed(
            () => this.isVisible() && (pool().nodes.count === 0)
        );

        this.deleteToolTip = ko.pureComputed( 
            () => this.isDeletable() ? 'delete pool' : 'pool has nodes'
        );
    }

    del() {
        deletePool(this.name());
    }    
}