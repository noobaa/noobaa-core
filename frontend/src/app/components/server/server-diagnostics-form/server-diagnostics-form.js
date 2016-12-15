import template from './server-diagnostics-form.html';
import Disposable from 'disposable';
import TestResultRowViewModel from './test-result-row';
import ko from 'knockout';
import { systemInfo, collectDiagnosticsState } from 'model';
import { deepFreeze, KeyByProperty } from 'utils/core-utils';
import { downloadServerDiagnosticPack, setServerDebugLevel } from 'actions';

const columns = deepFreeze([
    {
        name: 'result',
        type: 'icon'
    },
    {
        name: 'address',
        label: 'IP Address'
    },
    {
        name: 'name',
        label: 'Server Name'
    }
]);

class ServerDiagnosticsFormViewModel extends Disposable{
    constructor({ serverSecret }) {
        super();

        this.columns = columns;

        const servers = ko.pureComputed(
            () => systemInfo() ? systemInfo().cluster.shards[0].servers : []
        );

        this.server = ko.pureComputed(
            () => servers().find(
                ({ secret }) => secret === ko.unwrap(serverSecret)
            )
        );

        this.testResults = ko.pureComputed(
            () => {
                if (!this.server()) {
                    return {};
                }

                const { results = [] } = this.server().services_status.internal_cluster_connectivity;
                return KeyByProperty(results,'secret');
            }
        );

        this.otherServers = ko.pureComputed(
            () => servers().filter(
                ({ secret }) => secret !== ko.unwrap(serverSecret)
            )
        );

        this.isConnected = ko.pureComputed(
            () => this.server() && this.server().status === 'CONNECTED'
        );

        const debugModeState = ko.pureComputed(
            () => this.server() && this.server().debug_level > 0
        );

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                value: ko.pureComputed(
                    () => debugModeState() ?
                        'On' :
                        'Off <span class="warning">(May cause server slowdown)</span>'
                )
            },
            {
                label: 'Time Left For Debugging',
                value: ko.pureComputed(
                    () => 'None'
                )
            }
        ];

        this.toggleDebugModeButtonLabel = ko.pureComputed(
            () => `Turn ${debugModeState() ? 'Off' : 'On'} Server Debug Mode`
        );

        this.isCollectingDiagnostics = ko.pureComputed(
            () => this.server() && collectDiagnosticsState()[
                    `server:${this.server().secret}`
                ]
        );
    }

    toggleDebugLevel() {
        const { secret, hostname, debug_level } = this.server();
        setServerDebugLevel(secret, hostname, debug_level === 0 ? 5 : 0);
    }

    downloadDiagnosticPack() {
        const { secret, hostname } = this.server();
        downloadServerDiagnosticPack(secret, hostname);
    }

    createServerRow(server) {
        return new TestResultRowViewModel(server, this.testResults);
    }
}

export default {
    viewModel: ServerDiagnosticsFormViewModel,
    template: template
};
