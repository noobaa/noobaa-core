/* Copyright (C) 2016 NooBaa */

import template from './alerts-overview.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { openAlertsDrawer } from 'action-creators';

class AlertsOverviewViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    alertsIcon = ko.observable();
    alertsTooltip = ko.observable();
    alertsSummary = ko.observable();

    selectState(state) {
        // Using the system for indication that we got enough information in order to delay the
        // rendering untill the component in the overview can render
        return [
            Boolean(state.system),
            state.alerts.unreadCounts
        ];
    }

    mapStateToProps(systemLoaded, unreadAlertsCounters) {
        if (!systemLoaded) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { crit, major, info } = unreadAlertsCounters;
            const alertsSummary = stringifyAmount('unread critical alert', crit, 'No');

            const alertsIcon = crit ?
                { name: 'problem', css: 'error' } :
                { name: 'healthy', css: 'success'};

            const alertsTooltip =  {
                template: 'listWithCaption',
                text: {
                    title: 'Uread alerts',
                    list: [
                        `${crit} Critical`,
                        `${major} Important`,
                        `${info} Minor`
                    ]
                }
            };

            ko.assignToProps(this, {
                dataReady: true,
                alertsIcon,
                alertsTooltip,
                alertsSummary
            });
        }
    }

    onViewAlerts() {
        this.dispatch(openAlertsDrawer('CRIT', true));
    }
}

export default {
    viewModel: AlertsOverviewViewModel,
    template: template
};
