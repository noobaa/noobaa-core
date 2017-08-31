/* Copyright (C) 2016 NooBaa */

import template from './version-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { upgradeSystem as upgradeSystemAction } from 'actions';
import { upgradeSystem } from 'action-creators';
import { action$ } from 'state';
import { upgradePackageSuffix } from 'config';
import { deepFreeze } from 'utils/core-utils';

const licenseInfoLink =
    '<a class="link" target="_blank" href="/public/license-info">See details</a>';

const unavailableUpgradeMessages = deepFreeze({
    NOT_ALL_MEMBERS_UP: 'Some of the cluster members cannot be reached',
    NOT_ENOUGH_SPACE: 'Not enough free disk space on some cluster members'
});

class AboutFormViewModel extends BaseViewModel {
    constructor() {
        super();

        const version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );

        const lastUpgrade = ko.pureComputed(
            () => systemInfo() && systemInfo().upgrade.last_upgrade
        ).extend({
            formatTime: true
        });

        const clusterVersionStatus = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                const { servers } = systemInfo().cluster.shards[0];
                const upToDateCount = servers.reduce(
                    (sum, server) => sum + Number(server.version === version()),
                    0
                );

                const countText = upToDateCount < servers.length ?
                    `${upToDateCount} of ${servers.length}` :
                    'All';

                return  `${countText} servers are synced with current version`;
            }
        );

        this.versionInfo = [
            {
                label: 'Current version',
                value: version
            },
            {
                label: 'Last upgrade',
                value: lastUpgrade

            },
            {
                label: 'Cluster status',
                value: clusterVersionStatus
            },
            {
                label: 'License information',
                value: licenseInfoLink
            }
        ];

        const upgradeUnavailable = ko.pureComputed(
            () => !systemInfo() || systemInfo().upgrade.unavailable
        );

        this.allowUpgrade = ko.pureComputed(
            () => !upgradeUnavailable()
        );

        this.unavailableUpgradeMessage = ko.pureComputed(
            () => {
                const reason = upgradeUnavailable();
                return reason ? unavailableUpgradeMessages[reason] : '';
            }
        );

        this.upgradePackageSuffix = upgradePackageSuffix;
    }

    onUpgrade(upgradePackage) {
        // REFACTOR - should be merged into one dispatcher (upgradeSystem)
        action$.onNext(upgradeSystem(upgradePackage));
        upgradeSystemAction(upgradePackage);
    }
}

export default {
    viewModel: AboutFormViewModel,
    template: template
};
