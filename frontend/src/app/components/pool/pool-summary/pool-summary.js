/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { deepFreeze, isNumber } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import style from 'style';

const activityTypeMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Deactivating',
    DELETING: 'Deleting'
});

function _getActivityText(type, nodeCount) {
    return `${activityTypeMapping[type]} ${stringifyAmount('drive', nodeCount)}`;
}

function _getActivityEta(eta) {
    return isNumber(eta) ? moment(eta).fromNow() : 'calculating...';
}

function _getActivityTooltipRow({ type, nodeCount, progress, eta }) {
    return `
        <p>${_getActivityText(type, nodeCount)} ${numeral(progress).format('%')}</p>
        <p class="remark push-next-half">ETA: ${_getActivityEta(eta)}</p>
    `;
}

class PoolSummaryViewModel2 extends Observer {
    constructor({ poolName }) {
        super();

        this.poolLoaded = ko.observable(false);

        // State observables.
        this.state = ko.observable();
        this.hostCount = ko.observable();
        this.healthyCount = ko.observable();
        this.issuesCount= ko.observable();
        this.offlineCount = ko.observable();
        this.hostCounters = [
            {
                label: 'Healthy',
                color: style['color12'],
                value: this.healthyCount
            },
            {
                label: 'Issues',
                color: style['color11'],
                value: this.issuesCount
            },
            {
                label: 'Offline',
                color: style['color10'],
                value: this.offlineCount
            }
        ];

        // Capacity observables.
        this.totalCapacity = ko.observable();
        this.availableCapacity = ko.observable();
        this.unavailableCapacity = ko.observable();
        this.usedByNoobaaCapacity = ko.observable();
        this.usedByOthersCapacity = ko.observable();
        this.reservedCapacity = ko.observable();
        this.inProcessHotsts = ko.observable();
        this.pieValues = [
            {
                label: 'Currently Available',
                color: style['color5'],
                value: this.availableCapacity
            },
            {
                label: 'Unavailable Nodes',
                color: style['color17'],
                value: this.unavailableCapacity
            },
            {
                label: 'Used (NooBaa)',
                color: style['color13'],
                value: this.usedByNoobaaCapacity
            },
            {
                label: 'Used (Other)',
                color: style['color14'],
                value: this.usedByOthersCapacity
            },
            {
                label: 'Reserved',
                color: style['color7'],
                value: this.reservedCapacity
            }
        ];

        // Data activity observables.
        this.hasActivities = ko.observable();
        this.activitiesTitle = ko.observable();
        this.activityText = ko.observable();
        this.activityDone = ko.observable();
        this.activityLeft = ko.observable();
        this.activityPrecentage = ko.observable();
        this.activityEta = ko.observable();
        this.hasAdditionalActivities = ko.observable();
        this.additionalActivitiesMessage = ko.observable();
        this.additionalActivitiesTooltip = ko.observable();
        this.activityBar = {
            values: [
                {
                    value: this.activityDone,
                    color: style['color8']
                },
                {
                    value: this.activityLeft,
                    color: style['color15']
                }
            ],
            marker: {
                placement: this.activityDone,
                label: this.activityPrecentage
            }
        };

        this.observe(state$.get('hostPools', ko.unwrap(poolName)), this.onPool);
    }

    onPool(pool) {
        if (!pool) return;
        const { hostCount, hostsByMode, storage, activities } = pool;

        { // Update pool state and counters
            const { OPTIMAL = 0, OFFLINE = 0 } = hostsByMode;
            this.state({
                name: 'healthy',
                css: 'success',
                tooltip: 'Healthy'
            });
            this.hostCount(numeral(hostCount).format('0,0'));
            this.healthyCount(numeral(OPTIMAL).format('0,0'));
            this.offlineCount(numeral(OFFLINE).format('0,0'));
            this.issuesCount(numeral(hostCount - OPTIMAL - OFFLINE).format('0,0'));
        }

        { // Update pool stroage and usage
            const { total, free, unavailable_free, used, used_other, reserved } = storage;
            this.totalCapacity(formatSize(total));
            this.availableCapacity(toBytes(free));
            this.unavailableCapacity(toBytes(unavailable_free));
            this.usedByNoobaaCapacity(toBytes(used));
            this.usedByOthersCapacity(toBytes(used_other));
            this.reservedCapacity(toBytes(reserved));
        }

        { // Update pool data activity summary
            const { hostCount, list } = activities;
            if (list.length > 0) {
                const { type, nodeCount, progress, eta } = list[0] || {};
                this.hasActivities(true);
                this.activitiesTitle(`${stringifyAmount('Node', hostCount)} in Process`);
                this.activityText(_getActivityText(type, nodeCount));
                this.activityDone(progress);
                this.activityLeft(1 - progress);
                this.activityPrecentage(numeral(progress).format('%'));
                this.activityEta(_getActivityEta(eta));

                const additionalActivities = list.slice(1);
                if (additionalActivities.length > 0) {
                    const message = `${stringifyAmount('More activity', additionalActivities.length)} running`;

                    this.hasAdditionalActivities(true);
                    this.additionalActivitiesMessage(message);
                    this.additionalActivitiesTooltip(additionalActivities.map(_getActivityTooltipRow));

                } else {
                    this.hasAdditionalActivities(false);
                }

            } else {
                this.hasActivities(false);
                this.activitiesTitle('No Activities');
                this.activityText('Pool has no activity');
            }
        }

        // Mark the pool as loaded
        this.poolLoaded(true);
    }
}

export default {
    viewModel: PoolSummaryViewModel2,
    template: template
};
