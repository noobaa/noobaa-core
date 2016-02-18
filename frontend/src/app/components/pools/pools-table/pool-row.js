import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils';
import { deletePool } from 'actions';

const cannotDeleteReasons = Object.freeze({
    NOTEMPTY: 'Cannot delete pool with nodes',
    SYSTEM : 'Cannot delete system defined pool',
    ASSOCIATED: 'Cannot delete a pool that assigned to a bucket policy'
});

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

        this.canBeDeleted = ko.pureComputed(
            () => pool() && pool().deletions && pool().deletions && pool().deletions.can_be_deleted
        );

        this.deleteToolTip = ko.pureComputed(
            () => pool() && (
                this.canBeDeleted() ?
                    'delete pool' :
                    cannotDeleteReasons[pool().deletions.reason]
            )
        );
    }

    del() {
        deletePool(this.name());
    }
}
