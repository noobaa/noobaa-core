import template from './node-diagnostics-form.html';
import ko from 'knockout';
import { raiseNodeDebugLevel, downloadNodeDiagnosticPack } from 'actions';

class NodeDiagnosticsFormViewModel {
    constructor({ node }) {
        this.nodeName = ko.pureComputed(
            () => node() && node().name
        );

        this.debugLevel = ko.pureComputed(
            () => node() && node().debug_level
        );

        this.debugLevelText = ko.pureComputed(
            () => this.debugLevel() === 0 ? 'Low' : 'High'
        );

        this.rpcAddress = ko.pureComputed(
            () => node() && node().rpc_address
        );

        this.isTestNodeModalVisible = ko.observable(false);
    }    

    raiseDebugLevel() {
        raiseNodeDebugLevel(this.nodeName());
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
}