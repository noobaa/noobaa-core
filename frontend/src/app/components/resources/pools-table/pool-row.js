import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deletePool } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import { getPoolStateIcon, getPoolCapacityBarValues,
    countNodesByState } from 'utils/ui-utils';

const undeletableReasons = deepFreeze({
    DEMO_POOL: 'Demo pools cannot be deleted',
    SYSTEM_ENTITY: 'Cannot delete system defined default pool',
    NOT_EMPTY: 'Cannot delete a pool which contains nodes',
    IN_USE: 'Cannot delete a pool that is assigned to a bucket policy',
    DEFAULT_RESOURCE: 'Cannot delete a pool that is used as a default resource by an account'
});

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

        const nodeCoutners = ko.pureComputed(
            () => pool() ? countNodesByState(pool().nodes.by_mode) : {}
        );


        this.nodeCount = ko.pureComputed(
            () => nodeCoutners().all
        ).extend({
            formatNumber: true
        });

        this.healthyCount = ko.pureComputed(
            () => nodeCoutners().healthy
        ).extend({
            formatNumber: true
        });

        this.issuesCount = ko.pureComputed(
            () => nodeCoutners().hasIssues
        ).extend({
            formatNumber: true
        });

        this.offlineCount = ko.pureComputed(
            () => nodeCoutners().offline
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

                    return undeletableReasons[
                        (isDemoPool() && 'DEMO_POOL') ||
                        pool().undeletable ||
                        ''
                    ];
                }
            ),
            onDelete: () => deletePool(pool().name)
        };
    }
}
