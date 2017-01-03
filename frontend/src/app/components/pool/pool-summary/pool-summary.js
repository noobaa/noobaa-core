import template from './pool-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import style from 'style';
import { deepFreeze, isNumber, assignWith } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';

const stateMapping = deepFreeze({
    healthy: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    empty: {
        text: 'Pool is empty',
        css: 'error',
        icon: 'problem'
    },
    allNodesOffline: {
        text: 'All nodes are offline',
        css: 'error',
        icon: 'problem'
    },
    notEnoughOnlineNodes: {
        text: 'Not enough online nodes',
        css: 'error',
        icon: 'problem'
    },
    manyNodesOffline: percentage => ({
        text: `${percentage} nodes are offline`,
        css: 'warning',
        icon: 'problem'
    }),
    noCapacity: {
        text: 'No available pool capacity',
        css: 'error',
        icon: 'problem'
    },
    lowCapacity: {
        text : 'Available capacity is low',
        css: 'warning',
        icon: 'problem'
    },
    highDataActivity: {
        text: 'High data activity in pool',
        css: 'warning',
        icon: 'working'
    }
});

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Deactivating',
    DELETING: 'Deleting'
});

function activityLabel(reason, count) {
    const activityName = activityNameMapping[reason];
    return  `${activityName} ${count} Node${count !== 1 ? 's' : ''}`;
}

function activityETA(time) {
    if (!isNumber(time && time.end)){
        return 'calculating...';
    }

    return moment(time.end).fromNow();
}

const noCapaityLimit =  Math.pow(1024, 2); // 1MB
const lowCapacityHardLimit = 50 * Math.pow(1024, 3); // 50GB;

class PoolSummaryViewModel extends BaseViewModel {
    constructor({ pool }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!pool()
        );

        const dataActivities = ko.pureComputed(
            () => pool().data_activities || []
        );

        this.state = ko.pureComputed(
            () => {
                const { count, online, has_issues } = pool().nodes;
                const offlineRatio = 1 - ((online + has_issues) / count);

                const { free, total, reserved, used_other } = assignWith(
                    {},
                    pool().storage,
                    (_, value) => toBytes(value)
                );
                const freeRatio = free / (total - reserved - used_other);

                const activityCount = dataActivities().reduce(
                    (sum, { count }) => sum + count,
                    0
                );
                const activityRatio = activityCount / count;

                if (count === 0) {
                    return stateMapping.empty;

                } else if (online === 0) {
                    return stateMapping.allNodesOffline;

                } else if(online < 3) {
                    return stateMapping.notEnoughOnlineNodes;

                } else if (offlineRatio >= .3) {
                    return stateMapping.manyNodesOffline(
                        numeral(offlineRatio).format('%')
                    );

                } else if (free < noCapaityLimit) {
                    return stateMapping.noCapacity;

                // Low capacity hard limit.
                } else if (free < lowCapacityHardLimit) {
                    return stateMapping.lowCapacity;

                // Low capacity soft limit.
                } else if (freeRatio <= .2) {
                    return stateMapping.lowCapacity;

                } else if (activityRatio >= .5) {
                    return stateMapping.highDataActivity;

                } else {
                    return stateMapping.healthy;
                }
            }
        );

        this.nodeCount = ko.pureComputed(
            () => numeral(pool().nodes.count).format('0,0')
        );

        this.onlineCount = ko.pureComputed(
            () => numeral(pool().nodes.online).format('0,0')
        );

        this.offlineCount = ko.pureComputed(
            () => numeral(pool().nodes.count - pool().nodes.online).format('0,0')
        );

        const storage = ko.pureComputed(
            () => pool().storage
        );

        this.formattedTotal = ko.pureComputed(
            () => storage().total
        ).extend({
            formatSize: true
        });

        this.pieValues = [
            {
                label: 'Currently Avaliable',
                color: style['color5'],
                value: ko.pureComputed(
                    () => toBytes(storage().free)
                )
            },
            {
                label: 'Unavailable',
                color: style['color17'],
                value: ko.pureComputed(
                    () => toBytes(storage().unavailable_free)
                )
            },
            {
                label: 'Used (NooBaa)',
                color: style['color13'],
                value: ko.pureComputed(
                    () => toBytes(storage().used)
                )
            },
            {
                label: 'Used (Other)',
                color: style['color14'],
                value: ko.pureComputed(
                    () => toBytes(storage().used_other)
                )

            },
            {
                label: 'Reserved',
                color: style['color7'],
                value: ko.pureComputed(
                    () => toBytes(storage().reserved)
                )
            }
        ];

        const firstActivity = ko.pureComputed(
            () => dataActivities()[0]
        );

        const additionalActivities = ko.pureComputed(
            () => dataActivities().filter(
                (_, i) => i >= 1
            )
        );

        this.hasActivities = ko.pureComputed(
            () => dataActivities().length > 0
        );

        this.activityTitle = ko.pureComputed(
            () => {
                if (!this.hasActivities()) {
                    return 'No Activities';
                }

                const { reason, count } = firstActivity();
                return activityLabel(reason, count);
            }
        );

        this.activityProgressBarValues = [
            {
                value: ko.pureComputed(
                    () => firstActivity() ? firstActivity().progress : 0
                ),
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => firstActivity() ? 1 - firstActivity().progress : 1
                ),
                color: style['color15']
            }
        ];

        this.activityETA = ko.pureComputed(
            () => activityETA(firstActivity() && firstActivity().time)
        );

        this.hasAdditionalActivities = ko.pureComputed(
            () => additionalActivities().length > 0
        );

        this.additionalActivitiesMessage = ko.pureComputed(
            () => {
                const count = additionalActivities().length;
                if (count > 0) {
                    return `${count} more ${count === 1 ? 'activity' : 'activities'} running`;
                }
            }
        );

        this.additionalActivitiesTooltip = ko.pureComputed(
            () => additionalActivities().map(
                activity => {
                    const { reason, count, progress, time } = activity;
                    return `${
                        activityLabel(reason, count)
                    } (${
                        numeral(progress).format('0%')
                    })<div class="remark">ETA: ${
                        activityETA(time)
                    }</div>`;
                }
            )
        );
    }
}

export default {
    viewModel: PoolSummaryViewModel,
    template: template
};
