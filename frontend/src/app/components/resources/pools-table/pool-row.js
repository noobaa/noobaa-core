import Disposable from 'disposable';
import ko from 'knockout';
import { deletePool } from 'actions';

export default class PoolRowViewModel extends Disposable {
    constructor(pool, deleteGroup, poolsToBuckets) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                let { count, has_issues } = pool().nodes;
                let healthy = count - has_issues >= 3;
                return {
                    css: healthy ? 'success' : 'error',
                    name: healthy ? 'healthy' : 'problem',
                    tooltip: healthy ? 'Healthy' : 'not enough healthy nodes'
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

        this.buckets = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                let buckets = poolsToBuckets()[pool().name] || [];
                let count = buckets.length;

                return {
                    text: `${count} bucket${count != 1 ? 's' : ''}`,
                    tooltip: count ? buckets : null
                };
            }
        );

        this.nodeCount = ko.pureComputed(
            () => pool() && pool().nodes.count
        ).extend({
            formatNumber: true
        });

        this.onlineCount = ko.pureComputed(
            () => pool() && pool().nodes.online
        ).extend({
            formatNumber: true
        });

        this.offlineCount = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                let { count, online } = pool().nodes;
                return count - online;
            }
        ).extend({
            formatNumber: true
        });

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
                    if (!pool()) {
                        return;
                    }

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
