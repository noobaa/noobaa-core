import template from './version-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { upgradeSystem } from 'actions';
import { upgradePackageSuffix } from 'config';

const licenseInfoLink =
    '<a class="link" target="_blank" href="/public/license-info">See details</a>';

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

        this.upgradePackageSuffix = upgradePackageSuffix;

        this.isUpgradingModalVisible = ko.observable(false);
    }

    upgrade(upgradePackage) {
        this.isUpgradingModalVisible(true);
        upgradeSystem(upgradePackage);
    }
}

export default {
    viewModel: AboutFormViewModel,
    template: template
};
