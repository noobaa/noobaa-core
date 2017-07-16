/* Copyright (C) 2016 NooBaa */

import template from './node-diagnostics-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { nodeInfo, collectDiagnosticsState } from 'model';
import { setNodeDebugLevel, downloadNodeDiagnosticPack } from 'actions';
import { action$ } from 'state';
import { openTestNodeModal } from 'action-creators';

class NodeDiagnosticsFormViewModel extends BaseViewModel {
    constructor() {
        super();

        const node = nodeInfo;

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

        this.debugMode = ko.pureComputed(
            () => Boolean(node() && node().debug_level)
        );

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                value: ko.pureComputed(
                    () => this.debugMode() ?
                        'On <span class="warning">(May cause daemon slowdown)</span>' :
                        'Off'
                )
            },
            {
                label: 'Time Left For Debugging',
                value: ko.pureComputed(
                    () => 'None'
                ),
                disabled: true
            }
        ];

        this.toggleDebugModeButtonText = ko.pureComputed(
            () => `Turn ${
                    this.debugMode() > 0 ? 'off' : 'on'
                } Node Debug Mode`
        );

        this.rpcAddress = ko.pureComputed(
            () => node() && node().rpc_address
        );

        this.isTestNodeModalVisible = ko.observable(false);
    }

    toggleDebugMode() {
        setNodeDebugLevel(this.nodeName(), this.debugMode() ? 0 : 5);
    }


    downloadDiagnosticPack() {
        downloadNodeDiagnosticPack(this.nodeName());
    }

    onRunTest() {
        action$.onNext(openTestNodeModal(this.rpcAddress()));
    }
}

export default {
    viewModel: NodeDiagnosticsFormViewModel,
    template: template
};
