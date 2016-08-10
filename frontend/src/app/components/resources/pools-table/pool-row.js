import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deletePool } from 'actions';

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

        let storage = ko.pureComputed(
            () => pool() ? pool().storage : {}
        );

        this.capacity = {
            total: ko.pureComputed(
                () => storage().total
            ),
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: ko.pureComputed(
                        () => storage().used
                    )
                },
                {
                    label: 'Used (other)',
                    value: ko.pureComputed(
                        () => storage().used_other
                    )
                }
            ]
        };

        let isDemoPool = ko.pureComputed(
            () => Boolean(pool() && pool().demo_pool)
        );

        let isUndeletable = ko.pureComputed(
            () => Boolean(pool() && pool().undeletable)
        );

        this.deleteButton = {
            subject: 'pool',
            group: deleteGroup,
            undeletable: isUndeletable,
            tooltip: ko.pureComputed(
                () => {
                    if (isDemoPool()) {
                        return 'Demo pools cannot be deleted';
                    }

                    let { undeletable } = pool();
                    if (undeletable === 'SYSTEM_ENTITY') {
                        return 'Cannot delete system defined default pool';
                    }

                    if (undeletable === 'NOT_EMPTY') {
                        return 'Cannot delete a pool which contains nodes';
                    }

                    if (undeletable === 'IN_USE') {
                        return 'Cannot delete a pool that is assigned to a bucket policy';
                    }
                }
            ),
            onDelete: () => deletePool(pool().name)
        };
    }
}
