import template from './overview-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';

class OverviewPanelViewModel extends Disposable {
    constructor() {
        super();

        this.isReady = ko.pureComputed(
            () => !!systemInfo()
        );

        this.nodePoolsCount = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                    pool => Boolean(pool.nodes)
                )
                .length
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.cloudResourcesCount = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                    pool => Boolean(pool.cloud_info)
                )
                .length
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.onlineNodeCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.online : 0
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.offlineNodeCount = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 0;
                }

                let { count, online } = systemInfo().nodes;
                return count - online;
            }
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.bucketCount = ko.pureComputed(
            () => (systemInfo() ? systemInfo().buckets : []).length
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.objectCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().objects : 0
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.cloudSyncCount = ko.pureComputed(
            () => (systemInfo() ? systemInfo().buckets : [])
                .filter(
                    bucket => Boolean(bucket.cloud_sync)
                )
                .length
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.systemCapacity = ko.pureComputed(
            () => systemInfo() && systemInfo().storage.total
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });


        this.systemFreeSpace = ko.pureComputed(
            () => systemInfo() && systemInfo().storage.free
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });



        this.isInstallNodeModalVisible = ko.observable(false);
        this.isConnectApplicationWizardVisible = ko.observable(false);
    }

    showInstallNodeModal() {
        this.isInstallNodeModalVisible(true);
    }

    hideInstallNodeModal() {
        this.isInstallNodeModalVisible(false);
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
