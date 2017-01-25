import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { deletePool } from 'actions';
import { getPoolStateIcon, getPoolCapacityBarValues } from 'utils/ui-utils';

export default class PoolRowViewModel extends BaseViewModel {
    constructor(pool, deleteGroup, poolsToBuckets) {
        super();

        this.state = ko.pureComputed(
            () => pool() ? getPoolStateIcon(pool()) : {}
        );

        this.name = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                return {
                    text: pool().name,
                    href: { route: 'pool', params: { pool: pool().name, tab: null } }
                };
            }
        );

        this.buckets = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                const buckets = poolsToBuckets()[pool().name] || [];
                const count = buckets.length;

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

                const { count, online } = pool().nodes;
                return count - online;
            }
        ).extend({
            formatNumber: true
        });

        this.capacity = ko.pureComputed(
            () => getPoolCapacityBarValues(pool() || {})
        );

        const isDemoPool = ko.pureComputed(
            () => Boolean(pool() && pool().demo_pool)
        );

        const isUndeletable = ko.pureComputed(
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

                    const { undeletable } = pool();
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
