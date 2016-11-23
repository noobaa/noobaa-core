import template from './node-diagnostics-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { collectDiagnosticsState } from 'model';
import { setNodeDebugLevel, downloadNodeDiagnosticPack } from 'actions';
import { isUndefined } from 'utils/all';

class NodeDiagnosticsFormViewModel extends Disposable {
    constructor({ node }) {
        super();

        this.nodeName = ko.pureComputed(
            () => node() && node().name
        );

        this.areActionsDisabled = ko.pureComputed(
            () => Boolean(node() && (!node().online || node().demo_node))
        );
        this.isCollectingDiagnostics = ko.pureComputed(
            () => Boolean(collectDiagnosticsState()[
                `node:${this.nodeName()}`
            ])
        );

        this.actionsTooltip = ko.pureComputed(
            () => {
                if (node()) {
                    let { demo_node, online } = node();

                    if (demo_node) {
                        return 'Diagnostics operations are not supported for demo nodes';
                    }

                    if (!online) {
                        return 'Node must be online for diagnostics operations';
                    }
                }
            }

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
