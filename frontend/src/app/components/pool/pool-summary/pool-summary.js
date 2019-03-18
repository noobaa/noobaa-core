/* Copyright (C) 2016 NooBaa */

import template from './pool-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { isNumber } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { unassignedRegionText, getHostPoolStateIcon } from 'utils/resource-utils';
import { getActivityName, getActivityListTooltip } from 'utils/host-utils';
import moment from 'moment';

function _mapStateAndStatus(pool) {
    const { hostCount, storageNodeCount, region } = pool;

    return {
        state: getHostPoolStateIcon(pool),
        hostCount: numeral(hostCount).format('0,0'),
        driveCount: numeral(storageNodeCount).format('0,0'),
        region: region || unassignedRegionText
    };
}

function _mapStorageAndUsage(pool) {
    const { free, unavailableFree, used, usedOther, reserved } = pool.storage;
    return {
        availableCapacity: toBytes(free),
        unavailableCapacity: toBytes(unavailableFree),
        usedByNoobaaCapacity: toBytes(used),
        usedByOthersCapacity: toBytes(usedOther),
        reservedCapacity: toBytes(reserved)
    };
}

function _mapFirstActivity(pool) {
    const { hostCount, list } = pool.activities;
    if (list.length > 0) {
        const { kind, nodeCount, progress, eta } = list[0] || {};
        const activityText = `${getActivityName(kind)} ${stringifyAmount('drive', nodeCount)}`;
        const etaText =  isNumber(eta) ? moment(eta).fromNow() : 'calculating...';
        return {
            hasActivities: true,
            activitiesTitle: `${stringifyAmount('Node', hostCount)} in Process`,
            activityText: activityText,
            activityProgress: progress,
            activityEta: etaText
        };

    } else {
        return {
            hasActivities: false,
            activitiesTitle: 'No Activities',
            activityText: 'Pool has no activity'
        };
    }
}

function _mapAdditionalActivities(pool) {
    const { list } = pool.activities;
    const additionalActivities = list.slice(1);
    if (additionalActivities.length > 0) {
        const message = `${stringifyAmount('More activity', additionalActivities.length)} running`;
        return {
            hasAdditionalActivities: true,
            additionalActivitiesMessage: message,
            additionalActivitiesTooltip: getActivityListTooltip(additionalActivities)
        };

    } else {
        return {
            hasAdditionalActivities: false
        };
    }
}

class PoolSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();

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
            color: 'rgb(var(--color09))',
            value: this.availableCapacity,
            tooltip: 'The total aggregated storage from installed nodes in this pool, does not include any offline or deactivated node'
        },
        {
            label: 'Unavailable Capacity',
            color: 'rgb(var(--color14))',
            value: this.unavailableCapacity,
            tooltip: 'The total aggregated storage from offline nodes or excluded drives in this pool'
        },
        {
            label: 'NooBaa Usage',
            color: 'rgb(var(--color20))',
            value: this.usedByNoobaaCapacity,
            tooltip: 'The actual storage utilization of this pool by the buckets connected to it'
        },
        {
            label: 'Other Usage',
            color: 'rgb(var(--color29))',
            value: this.usedByOthersCapacity,
            tooltip: 'The machines utilization by OS, local files etc'
        },
        {
            label: 'Reserved',
            color: 'rgb(var(--color25))',
            value: this.reservedCapacity,
            tooltip: 'NooBaa reserves 10GB from each storage node to avoid a complete utilization of the local storage on the machine'
        }
    ];

    // Data activity observables.
    hasActivities = ko.observable();
    activitiesTitle = ko.observable();
    activityText = ko.observable();
    activityProgress = ko.observable();
    activityEta = ko.observable();
    hasAdditionalActivities = ko.observable();
    additionalActivitiesMessage = ko.observable();
    additionalActivitiesTooltip = ko.observable();

    selectState(state, params) {
        const { hostPools } = state;
        return [
            hostPools && hostPools[params.poolName]
        ];
    }

    mapStateToProps(pool) {
        if (!pool) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else  {
            ko.assignToProps(this, {
                dataReady: true,
                ..._mapStateAndStatus(pool),
                ..._mapStorageAndUsage(pool),
                ..._mapFirstActivity(pool),
                ..._mapAdditionalActivities(pool)
            });
        }
    }
}

export default {
    viewModel: PoolSummaryViewModel,
    template: template
};
