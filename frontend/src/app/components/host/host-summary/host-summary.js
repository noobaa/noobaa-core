/* Copyright (C) 2016 NooBaa */

import template from './host-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { isNumber, mapValues } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import moment from 'moment';
import {
    getStorageServiceStateIcon,
    getEndpointServiceStateIcon,
    getHostStateIcon,
    getHostTrustIcon,
    getHostAccessibilityIcon,
    getActivityName,
    getActivityListTooltip
} from 'utils/host-utils';

const trustTooltip = `A reliability check that verifies that this node has no disk
    corruption or malicious activity`;

function _mapStateAndStatus(host) {
    return {
        storageServiceState: getStorageServiceStateIcon(host),
        endpointServiceState: getEndpointServiceStateIcon(host),
        stateIcon: getHostStateIcon(host),
        trustIcon: getHostTrustIcon(host),
        accessibilityIcon: getHostAccessibilityIcon(host)
    };
}

function _mapStorageAndUsage(host) {
    const {
        free = 0,
        unavailableFree = 0,
        used = 0,
        unavailableUsed = 0,
        usedOther = 0,
        reserved = 0
    } = mapValues(host.storage, toBytes);

    return {
        availableCapacity: free,
        unavailableCapacity: unavailableFree,
        usedByNoobaaCapacity: used + unavailableUsed,
        usedByOthersCapacity: usedOther,
        reservedCapacity: reserved
    };
}

function _mapFirstActivity(host) {
    const list = host.activities;
    if (list.length > 0) {
        const { kind, nodeCount, progress, eta } = list[0] || {};
        const activityText = `${getActivityName(kind)} ${stringifyAmount('drive', nodeCount)}`;
        const etaText =  isNumber(eta) ? moment(eta).fromNow() : 'calculating...';
        return {
            hasActivities: true,
            activitiesTitle: `${stringifyAmount('Drive', nodeCount)} in Process`,
            activityText: activityText,
            activityProgress: progress,
            activityEta: etaText
        };

    } else {
        return {
            hasActivities: false,
            activitiesTitle: 'No Activities',
            activityText: 'Node has no activity'
        };
    }
}

function _mapAdditionalActivities(host) {
    const list = host.activities;
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


class HostSummaryViewModel extends ConnectableViewModel {
    dataReady  = ko.observable();

    // State observables.
    trustTooltip = trustTooltip;
    storageServiceState = ko.observable({});
    endpointServiceState = ko.observable({});
    stateIcon = ko.observable({});
    trustIcon = ko.observable({});
    accessibilityIcon = ko.observable({});

    // Capacity observables.
    availableCapacity = ko.observable();
    unavailableCapacity = ko.observable();
    usedByNoobaaCapacity = ko.observable();
    usedByOthersCapacity = ko.observable();
    reservedCapacity = ko.observable();
    pieValues = [
        {
            label: 'Available',
            color: 'rgb(var(--color09))',
            value: this.availableCapacity,
            tooltip: 'The total storage of this machine, does not include any offline or deactivated drives'
        },
        {
            label: 'Unavailable Capacity',
            color: 'rgb(var(--color14))',
            value: this.unavailableCapacity,
            tooltip: 'The total storage from drives which are either offline or in process'
        },
        {
            label: 'NooBaa Usage',
            color: 'rgb(var(--color20))',
            value: this.usedByNoobaaCapacity,
            tooltip: 'The actual storage utilization of this node by the buckets connected to its assigned pool'
        },
        {
            label: 'Other Usage',
            color: 'rgb(var(--color29))',
            value: this.usedByOthersCapacity,
            tooltip: 'The machine utilization by OS, local files etc'
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
        const { hosts } = state;
        return [
            hosts && hosts.items && hosts.items[params.name]
        ];
    }

    mapStateToProps(host) {
        if (!host) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                ..._mapStateAndStatus(host),
                ..._mapStorageAndUsage(host),
                ..._mapFirstActivity(host),
                ..._mapAdditionalActivities(host)
            });
        }
    }
}

export default {
    viewModel: HostSummaryViewModel,
    template: template
};
