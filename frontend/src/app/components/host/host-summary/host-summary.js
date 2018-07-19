/* Copyright (C) 2016 NooBaa */

import template from './host-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { isNumber, mapValues } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { get } from 'rx-extensions';
import style from 'style';
import moment from 'moment';
import numeral from 'numeral';
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


class HostSummaryViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostLoaded  = ko.observable(false);

        // State observables.
        this.trustTooltip = trustTooltip;
        this.storageServiceState = ko.observable({});
        this.endpointServiceState = ko.observable({});
        this.stateIcon = ko.observable({});
        this.trustIcon = ko.observable({});
        this.accessibilityIcon = ko.observable({});

        // Capacity observables.
        this.availableCapacity = ko.observable(0);
        this.unavailableCapacity = ko.observable(0);
        this.usedByNoobaaCapacity = ko.observable(0);
        this.usedByOthersCapacity = ko.observable(0);
        this.reservedCapacity = ko.observable(0);
        this.pieValues = [
            {
                label: 'Available',
                color: style['color5'],
                value: this.availableCapacity,
                tooltip: 'The total storage of this machine, does not include any offline or deactivated drives'
            },
            {
                label: 'Unavailable Capacity',
                color: style['color17'],
                value: this.unavailableCapacity,
                tooltip: 'The total storage from drives which are either offline or in process'
            },
            {
                label: 'NooBaa Usage',
                color: style['color13'],
                value: this.usedByNoobaaCapacity,
                tooltip: 'The actual storage utilization of this node by the buckets connected to its assigned pool'
            },
            {
                label: 'Other Usage',
                color: style['color14'],
                value: this.usedByOthersCapacity,
                tooltip: 'The machine utilization by OS, local files etc'
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

        this.observe(
            state$.pipe(get('hosts', 'items', ko.unwrap(name))),
            this.onHost
        );
    }

    onHost(host) {
        if (!host) return;
        this.hostLoaded(true);

        { // Update host state
            this.storageServiceState(getStorageServiceStateIcon(host));
            this.endpointServiceState(getEndpointServiceStateIcon(host));
            this.stateIcon(getHostStateIcon(host));
            this.trustIcon(getHostTrustIcon(host));
            this.accessibilityIcon(getHostAccessibilityIcon(host) || {});
        }

        { // Update host storage and usage
            const {
                free = 0,
                unavailableFree = 0,
                used = 0,
                unavailableUsed = 0,
                usedOther = 0,
                reserved = 0
            } = mapValues(host.storage, toBytes);

            this.availableCapacity(free);
            this.unavailableCapacity(unavailableFree);
            this.usedByNoobaaCapacity(used + unavailableUsed);
            this.usedByOthersCapacity(usedOther);
            this.reservedCapacity(reserved);
        }

        { // Update host data activity summary
            const list = host.activities;
            if (list.length > 0) {
                const { kind, nodeCount, progress, eta } = list[0] || {};
                const activityText = `${getActivityName(kind)} ${stringifyAmount('drive', nodeCount)}`;
                const etaText =  isNumber(eta) ? moment(eta).fromNow() : 'calculating...';

                this.hasActivities(true);
                this.activitiesTitle(`${stringifyAmount('Drive', nodeCount)} in Process`);
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
                this.activityText('Node has no activity');
            }
        }
    }
}

export default {
    viewModel: HostSummaryViewModel,
    template: template
};
