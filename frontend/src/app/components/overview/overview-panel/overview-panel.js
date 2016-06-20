import template from './overview-panel.html';
import ko from 'knockout';
import { systemSummary, routeContext } from 'model';
import { redirectTo } from 'actions';
import { system as systemRoute } from 'routes';

class OverviewPanelViewModel {
    constructor() {
        this.isReady = ko.pureComputed(
            () => !!systemSummary()
        );

        this.systemCapacity = ko.pureComputed(
            () => systemSummary() && systemSummary().capacity
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        this.onlineNodeCount = ko.pureComputed(
            () => systemSummary() && systemSummary().onlineNodeCount
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.offlineNodeCount = ko.pureComputed(
            () => systemSummary() && systemSummary().offlineNodeCount
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.poolCount = ko.pureComputed(
            () => systemSummary() && systemSummary().poolCount
        )
        .extend({ formatNumber: true });

        this.nodeCount = ko.pureComputed(
            () => systemSummary() && systemSummary().nodeCount
        )
        .extend({ formatNumber: true });

        this.bucketCount = ko.pureComputed(
            () => systemSummary() && systemSummary().bucketCount
        )
        .extend({ formatNumber: true });

        this.objectCount = ko.pureComputed(
            () => systemSummary() && systemSummary().objectCount
        )
        .extend({ formatNumber: true });

        this.isInstallNodeWizardlVisible = ko.observable(false);
        this.isConnectAppWizardVisible = ko.observable(false);

        this.isAfterUpgradeModalVisible = ko.pureComputed(
            () => !!routeContext().query.afterupgrade
        );
    }

    closeAfterUpgradeModal() {
        redirectTo(systemRoute);
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
