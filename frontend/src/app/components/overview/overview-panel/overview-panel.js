import template from './overview-panel.html';
import ko from 'knockout';
import { systemInfo, routeContext } from 'model';
import { redirectTo } from 'actions';
import { system as systemRoute } from 'routes';

class OverviewPanelViewModel {
    constructor() {
        this.isReady = ko.pureComputed(
            () => !!systemInfo()
        );

        this.systemCapacity = ko.pureComputed(
            () => systemInfo() && systemInfo().capacity
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        this.onlineNodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().onlineNodeCount
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.offlineNodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().offlineNodeCount
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.poolCount = ko.pureComputed(
            () => systemInfo() && systemInfo().poolCount
        )
        .extend({ formatNumber: true });

        this.nodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().nodeCount
        )
        .extend({ formatNumber: true });

        this.bucketCount = ko.pureComputed(
            () => systemInfo() && systemInfo().bucketCount
        )
        .extend({ formatNumber: true });

        this.objectCount = ko.pureComputed(
            () => systemInfo() && systemInfo().objectCount
        )
        .extend({ formatNumber: true });

        this.isInstallNodeWizardlVisible = ko.observable(false);
        this.isConnectApplicationWizardVisible = ko.observable(false);

        this.isAfterUpgradeModalVisible = ko.pureComputed(
            () => !!routeContext().query.afterupgrade
        );
    }

    showInstallNodeWizard() {
        this.isInstallNodeWizardlVisible(true);
    }

    hideInstallNodeWizard() {
        this.isInstallNodeWizardlVisible(false);
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }

    hideAfterUpgradeModal() {
        redirectTo(systemRoute);
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
