import ko from 'knockout';
import numeral from 'numeral';
import { deletePool } from 'actions';

const cannotDeleteReasons = Object.freeze({
    SYSTEM_ENTITY: 'Cannot delete system defined default pool',
    NOT_EMPTY: 'Cannot delete a pool which contains nodes',
    IN_USE: 'Cannot delete a pool that is assigned to a bucket policy'
});

export default class PoolRowViewModel {
    constructor(pool) {
        this.isVisible = ko.pureComputed(
            () => !!pool()
        );

        this.stateIcon = 'pool';

        this.name = ko.pureComputed(
            () => pool() && pool().name
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

        this.used = ko.pureComputed(
            () => pool() && pool().storage.used
        );

        this.total = ko.pureComputed(
            () => pool() && pool().storage.total
        );

        this.canBeDeleted = ko.pureComputed(
            () => pool() && !pool().undeletable
        );

        this.deleteToolTip = ko.pureComputed(
            () => pool() && (
                this.canBeDeleted() ?
                    'delete pool' :
                    cannotDeleteReasons[pool().undeletable]
            )
        );
    }

    del() {
        deletePool(this.name());
    }
}
