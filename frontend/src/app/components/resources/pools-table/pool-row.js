import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deletePool } from 'actions';

const cannotDeleteReasons = Object.freeze({
    SYSTEM_ENTITY: 'Cannot delete system defined default pool',
    NOT_EMPTY: 'Cannot delete a pool which contains nodes',
    IN_USE: 'Cannot delete a pool that is assigned to a bucket policy'
});

export default class PoolRowViewModel extends Disposable {
    constructor(pool, deleteGroup) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                let healthy = pool().nodes.online >= 3;
                return {
                    name: `pool-${healthy ? 'healthy' : 'problem'}`,
                    tooltip: healthy ? 'Healthy' : 'not enough online nodes'
                };
            }
        );

        this.name = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                return {
                    text: pool().name,
                    href: { route: 'pool', params: { pool: pool().name } }
                };
            }
        );

        this.nodeCount = ko.pureComputed(
            () => pool() ? numeral(pool().nodes.count).format('0,0') : ''
        );

        this.onlineCount = ko.pureComputed(
            () => pool() ? numeral(pool().nodes.online).format('0,0') : ''
        );

        this.offlineCount = ko.pureComputed(
            () => pool() ? numeral(this.nodeCount() - this.onlineCount()).format('0,0') : ''
        );

        this.capacity = ko.pureComputed(
            () => pool() ? pool().storage : {}
        );

        let undeletable = ko.pureComputed(
            () => Boolean(pool() && pool().undeletable)
        );

        this.deleteButton = {
            deleteGroup: deleteGroup,
            undeletable: undeletable,
            deleteToolTip: ko.pureComputed(
                () => pool() && (
                    undeletable() ? cannotDeleteReasons[pool().undeletable] : 'delete pool'
                )
            ),
            onDelete: () => deletePool(pool().name)
        };
    }
}
