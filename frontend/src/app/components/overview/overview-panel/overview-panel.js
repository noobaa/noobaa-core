import template from './overview-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { stringifyAmount } from 'utils/string-utils';

class OverviewPanelViewModel extends Disposable {
    constructor() {
        super();

        this.nodePoolsCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().pools : [])
                    .filter(
                        pool => Boolean(pool.nodes)
                    )
                    .length;

                return stringifyAmount('Resource', count, 'No');
            }
        );

        this.cloudResourceCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().pools : [])
                    .filter(
                        pool => Boolean(pool.cloud_info)
                    )
                    .length;

                return stringifyAmount('Resource', count, 'No');
            }
        );

        this.serverCount = ko.pureComputed(
            () => {
                const count = (
                    systemInfo() ? systemInfo().cluster.shards[0].servers : []
                ).length;

                return stringifyAmount('Server', count, 'No');
            }
        );

        this.bucketCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().buckets : []).length;
                return stringifyAmount('Bucket', count, 'No');
            }
        );

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
