import template from './server-diagnostics-form.html';
import BaseViewModel from 'components/base-view-model';
import TestResultRowViewModel from './test-result-row';
import ko from 'knockout';
import { systemInfo, collectDiagnosticsState } from 'model';
import { deepFreeze, keyByProperty } from 'utils/core-utils';
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

class ServerDiagnosticsFormViewModel extends BaseViewModel {
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

                const { results = [] } = this.server().services_status.cluster_communication;
                return keyByProperty(results, 'secret', ({ status }) => status);
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

        this.debugMode = ko.pureComputed(
            () => Boolean(this.server() && this.server().debug_level)
        );

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                value: ko.pureComputed(
                    () => this.debugMode() ?
                        'On <span class="warning">(May cause server slowdown)</span>' :
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

        this.toggleDebugModeButtonLabel = ko.pureComputed(
            () => `Turn ${this.debugMode() ? 'Off' : 'On'} Server Debug Mode`
        );

        this.isCollectingDiagnostics = ko.pureComputed(
            () => this.server() && collectDiagnosticsState()[
                    `server:${this.server().secret}`
                ]
        );
    }

    toggleDebugLevel() {
        const { secret, hostname } = this.server();
        setServerDebugLevel(secret, hostname, this.debugMode() ? 0 : 5);
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
