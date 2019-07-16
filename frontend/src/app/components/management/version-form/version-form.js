// Copyright (C) 2016 NooBaa

import template from './version-form.html';
import ConnectableViewModel from 'components/connectable';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';

class VersionFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    versionInfo = [
        {
            label: 'Current Version',
            value: ko.observable()
        },
        {
            label: 'Last Upgrade',
            value: ko.observable()

        },
        {
            label: 'Automatic Upgrade',
            value: 'Upgraded via the operator'
        },
        {
            label: 'Version Information',
            value: true,
            template: 'licenseInfo',
            visible: false
        },
        {
            label: 'License Information',
            value: true,
            template: 'licenseInfo'
        }
    ];

    selectState(state) {
        return [
            state.system
        ];
    }

    mapStateToProps(system) {
        if (!system) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { version, upgrade } = system;
            const lastUpgradeText = upgrade.lastUpgrade ?
                moment(upgrade.lastUpgrade.time).format(timeShortFormat) :
                'System has never been upgraded';

            ko.assignToProps(this, {
                dataReady: true,
                versionInfo: [
                    { value: version },
                    { value: lastUpgradeText }
                ]
            });
        }
    }
}

export default {
    viewModel: VersionFormViewModel,
    template: template
};
