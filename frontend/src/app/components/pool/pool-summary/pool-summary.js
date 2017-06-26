/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import style from 'style';
import { deepFreeze, isNumber } from 'utils/core-utils';
import { getPoolStateIcon, countNodesByState } from 'utils/ui-utils';
import { toBytes } from 'utils/size-utils';

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
                const { name, css, tooltip } = getPoolStateIcon(pool());
                return {
                    icon: name,
                    css: css,
                    text: tooltip
                };
            }
        );

        const nodeCoutners = ko.pureComputed(
            () => countNodesByState(pool().nodes.by_mode)
        );

        this.nodeCount = ko.pureComputed(
            () => nodeCoutners().all
        ).extend({
            formatNumber: true
        });

        const healthyCount = ko.pureComputed(
            () => nodeCoutners().healthy
        ).extend({
            formatNumber: true
        });

        const offlineCount = ko.pureComputed(
            () => nodeCoutners().offline
        ).extend({
            formatNumber: true
        });

        const issueCount = ko.pureComputed(
            () => nodeCoutners().hasIssues
        ).extend({
            formatNumber: true
        });

        this.nodeCounters = [
            {
                label: 'Online',
                color: style['color12'],
                value: healthyCount
            },
            {
                label: 'Has issues',
                color: style['color11'],
                value: issueCount
            },
            {
                label: 'Offline',
                color: style['color10'],
                value: offlineCount
            }
        ];

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
                label: 'Currently Available',
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
