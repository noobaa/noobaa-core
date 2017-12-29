/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import numeral from 'numeral';
import { isNumber } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getHostsPoolStateIcon } from 'utils/resource-utils';
import { getActivityName, getActivityListTooltip } from 'utils/host-utils';
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
                value: this.healthyCount,
                tooltip: 'The number of fully operative storage nodes that can be used as a storage target for NooBaa'
            },
            {
                label: 'Issues',
                color: style['color11'],
                value: this.issuesCount,
                tooltip: 'The number of storage nodes that are partially operative due to a current process or low spec'
            },
            {
                label: 'Offline',
                color: style['color10'],
                value: this.offlineCount,
                tooltip: 'The number of storage nodes that are currently not operative and are not considered as part of NooBaa’s available storage'
            }
        ];

        // Capacity observables.
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
                value: this.availableCapacity,
                tooltip: 'The total aggregated storage from installed nodes in this pool, does not include any offline or deactivated node'
            },
            {
                label: 'Unavailable Capacity',
                color: style['color17'],
                value: this.unavailableCapacity,
                tooltip: 'The total aggregated storage from offline nodes in this pool'
            },
            {
                label: 'NooBaa Usage',
                color: style['color13'],
                value: this.usedByNoobaaCapacity,
                tooltip: 'The actual storage utilization of this pool by the buckets connected to it'
            },
            {
                label: 'Other Usage',
                color: style['color14'],
                value: this.usedByOthersCapacity,
                tooltip: 'The machines utilization by OS, local files etc'
            },
            {
                label: 'Reserved',
                color: style['color7'],
                value: this.reservedCapacity,
                tooltip: 'NooBaa reserves 10GB from each storage node to avoid a complete utilization of the local storage on the machine'
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

        { // Update pool storage and usage
            const { free, unavailableFree, used, usedOther, reserved } = storage;
            this.availableCapacity(toBytes(free));
            this.unavailableCapacity(toBytes(unavailableFree));
            this.usedByNoobaaCapacity(toBytes(used));
            this.usedByOthersCapacity(toBytes(usedOther));
            this.reservedCapacity(toBytes(reserved));
        }

        { // Update pool data activity summary
            const { hostCount, list } = activities;
            if (list.length > 0) {
                const { kind, nodeCount, progress, eta } = list[0] || {};
                const activityText = `${getActivityName(kind)} ${stringifyAmount('drive', nodeCount)}`;
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
                    this.additionalActivitiesTooltip(getActivityListTooltip(additionalActivities));

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
