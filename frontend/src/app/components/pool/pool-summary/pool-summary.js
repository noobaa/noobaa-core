/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import numeral from 'numeral';
import { isNumber } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { unassignedRegionText, getHostPoolStateIcon } from 'utils/resource-utils';
import { getActivityName, getActivityListTooltip } from 'utils/host-utils';
import { get } from 'rx-extensions';
import style from 'style';
import moment from 'moment';

class PoolSummaryViewModel extends Observer {
    poolLoaded = ko.observable(false);

    // State observables.
    state = ko.observable({});
    hostCount = ko.observable();
    driveCount = ko.observable();
    region = ko.observable();

    // Capacity observables.
    availableCapacity = ko.observable();
    unavailableCapacity = ko.observable();
    usedByNoobaaCapacity = ko.observable();
    usedByOthersCapacity = ko.observable();
    reservedCapacity = ko.observable();
    inProcessHotsts = ko.observable();
    pieValues = [
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
            tooltip: 'The total aggregated storage from offline nodes or excluded drives in this pool'
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
    hasActivities = ko.observable();
    activitiesTitle = ko.observable();
    activityText = ko.observable();
    activityDone = ko.observable();
    activityLeft = ko.observable();
    activityPrecentage = ko.observable();
    activityEta = ko.observable();
    hasAdditionalActivities = ko.observable();
    additionalActivitiesMessage = ko.observable();
    additionalActivitiesTooltip = ko.observable();
    activityBar = {
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

    constructor({ poolName }) {
        super();

        this.observe(
            state$.pipe(get('hostPools', ko.unwrap(poolName))),
            this.onPool
        );
    }

    onPool(pool) {
        if (!pool) return;
        const { hostCount, storageNodeCount, region, storage, activities } = pool;

        { // Update pool state, counters and region.
            this.state(getHostPoolStateIcon(pool));
            this.hostCount(numeral(hostCount).format('0,0'));
            this.driveCount(numeral(storageNodeCount).format('0,0'));
            this.region(region || unassignedRegionText);
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
