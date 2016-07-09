import template from './node-diagnostics-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { setNodeDebugLevel, downloadNodeDiagnosticPack } from 'actions';
import { isUndefined } from 'utils';

class NodeDiagnosticsFormViewModel extends BaseViewModel {
    constructor({ node }) {
        super();

        this.nodeName = ko.pureComputed(
            () => node() && node().name
        );

        this.debugLevel = ko.pureComputed(
            () => node() && node().debug_level
        );

        this.debugLevelText = ko.pureComputed(
            () => {
                if (isUndefined(this.debugLevel())) {
                    return 'N/A';
                }

                return this.debugLevel() > 0 ? 'High' : 'Low';
            }
        );

        this.toggleDebugLevelButtonText = ko.pureComputed(
            () => `${
                    this.debugLevel() > 0 ? 'Lower' : 'Raise'
                } Debug Level`
        );

        this.rpcAddress = ko.pureComputed(
            () => node() && node().rpc_address
        );

        this.isTestNodeModalVisible = ko.observable(false);
    }

    toggleDebugLevel() {
        let level = this.debugLevel() === 0 ? 5 : 0;
        setNodeDebugLevel(this.nodeName(), level);
    }


    downloadDiagnosticPack() {
        downloadNodeDiagnosticPack(this.nodeName());
    }

    showTestNodeModal() {
        this.isTestNodeModalVisible(true);
    }

    hideTestNodeModal() {
        this.isTestNodeModalVisible(false);
    }
}

export default {
    viewModel: NodeDiagnosticsFormViewModel,
    template: template
};
