/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import numeral from 'numeral';
import { isNumber } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getHostsPoolStateIcon } from 'utils/resource-utils';
import { getActivityName, formatActivityListTooltipHtml } from 'utils/host-utils';
import style from 'style';
import moment from 'moment';

class PoolSummaryViewModel extends Observer {
    constructor({ poolName }) {
        super();

        this.poolLoaded = ko.observable(false);

        // State observables.
        this.state = ko.observable({});
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
                label: 'Available',
                color: style['color5'],
                value: this.availableCapacity
            },
            {
                label: 'Unavailable Capacity',
                color: style['color17'],
                value: this.unavailableCapacity
            },
            {
                label: 'NooBaa Usage',
                color: style['color13'],
                value: this.usedByNoobaaCapacity
            },
            {
                label: 'Other Usage',
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
            this.state(getHostsPoolStateIcon(pool));
            this.hostCount(numeral(hostCount).format('0,0'));
            this.healthyCount(numeral(OPTIMAL).format('0,0'));
            this.offlineCount(numeral(OFFLINE).format('0,0'));
            this.issuesCount(numeral(hostCount - OPTIMAL - OFFLINE).format('0,0'));
        }

        { // Update pool stroage and usage
            const { total, free, unavailableFree, used, usedOther, reserved } = storage;
            this.totalCapacity(formatSize(total));
            this.availableCapacity(toBytes(free));
            this.unavailableCapacity(toBytes(unavailableFree));
            this.usedByNoobaaCapacity(toBytes(used));
            this.usedByOthersCapacity(toBytes(usedOther));
            this.reservedCapacity(toBytes(reserved));
        }

        { // Update pool data activity summary
            const { hostCount, list } = activities;
            if (list.length > 0) {
                const { type, nodeCount, progress, eta } = list[0] || {};
                const activityText = `${getActivityName(type)} ${stringifyAmount('drive', nodeCount)}`;
                const etaText =  isNumber(eta) ? moment(eta).fromNow() : 'calculating...';

                this.hasActivities(true);
                this.activitiesTitle(`${stringifyAmount('Node', hostCount)} in Process`);
                this.activityText(activityText);
                this.activityDone(progress);
                this.activityLeft(1 - progress);
                this.activityPrecentage(numeral(progress).format('%'));
                this.activityEta(etaText);

                const additionalActivities = list.slice(1);
                if (additionalActivities.length > 0) {
                    const message = `${stringifyAmount('More activity', additionalActivities.length)} running`;

                    this.hasAdditionalActivities(true);
                    this.additionalActivitiesMessage(message);
                    this.additionalActivitiesTooltip(formatActivityListTooltipHtml(additionalActivities));

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
    viewModel: PoolSummaryViewModel,
    template: template
};
