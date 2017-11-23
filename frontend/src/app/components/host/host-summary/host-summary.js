/* Copyright (C) 2016 NooBaa */

import template from './host-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { isNumber } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import style from 'style';
import moment from 'moment';
import numeral from 'numeral';
import {
    getStorageServiceStateIcon,
    getGatewayServiceStateIcon,
    getHostStateIcon,
    getHostTrustIcon,
    getHostAccessibilityIcon,
    getActivityName,
    formatActivityListTooltipHtml
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
        this.gatewayServiceState = ko.observable({});
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

        this.observe(state$.get('hosts', 'items', ko.unwrap(name)), this.onHost);
    }

    onHost(host) {
        if (!host) return;
        this.hostLoaded(true);

        { // Update host state
            this.storageServiceState(getStorageServiceStateIcon(host));
            this.gatewayServiceState(getGatewayServiceStateIcon(host));
            this.stateIcon(getHostStateIcon(host));
            this.trustIcon(getHostTrustIcon(host));
            this.accessibilityIcon(getHostAccessibilityIcon(host) || {});
        }

        { // Update host stroage and usage
            const { free, unavailableFree, used, usedOther, reserved } = host.storage;

            this.availableCapacity(toBytes(free));
            this.unavailableCapacity(toBytes(unavailableFree));
            this.usedByNoobaaCapacity(toBytes(used));
            this.usedByOthersCapacity(toBytes(usedOther));
            this.reservedCapacity(toBytes(reserved));
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
                    this.additionalActivitiesTooltip(formatActivityListTooltipHtml(additionalActivities));

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
