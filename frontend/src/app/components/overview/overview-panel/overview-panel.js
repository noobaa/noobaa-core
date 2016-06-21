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
            () => systemInfo() && systemInfo().storage.total
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        this.onlineNodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().nodes.online
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.offlineNodeCount = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return;
                }

                let { count, online } = systemInfo().nodes;
                return online - count;
            }
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.poolCount = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.length
        )
        .extend({ formatNumber: true });

        this.nodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().nodes.count
        )
        .extend({ formatNumber: true });

        this.bucketCount = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.length
        )
        .extend({ formatNumber: true });

        this.objectCount = ko.pureComputed(
            () => systemInfo() && systemInfo().objects
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
