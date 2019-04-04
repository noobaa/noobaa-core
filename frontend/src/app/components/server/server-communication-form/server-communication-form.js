/* Copyright (C) 2016 NooBaa */

import template from './server-communication-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getServerDisplayName } from 'utils/cluster-utils';

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

const icons = deepFreeze({
    notConnected: {
        name: 'problem',
        css: 'error',
        tooltip: 'Server not connected'
    },
    notOperational: {
        name: 'problem',
        css: 'error',
        tooltip: 'Cannot communicate with server'
    },
    connected: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Test completed successfully'
    }
});

class TestResultRowViewModel {
    result = {
        name: ko.observable(),
        css: ko.observable(),
        tooltip: ko.observable()
    };
    address = ko.observable();
    name = ko.observable();
}

class ServerCommunicationFormViewModel extends ConnectableViewModel {
    columns = columns;
    dataReady = ko.observable();
    rows = ko.observableArray()
        .ofType(TestResultRowViewModel)

    selectState(state, params) {
        const { topology } = state;
        return [
            params.serverSecret,
            topology && topology.servers
        ];
    }

    mapStateToProps(secret, servers) {
        if (!servers) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { clusterConnectivity } = servers[secret];

            ko.assignToProps(this, {
                dataReady: true,
                rows: Object.values(servers)
                    .filter(server => server.secret !== secret)
                    .map(server => {
                        const { mode, secret } = server;
                        const name = getServerDisplayName(server);
                        const address = server.addresses[0].ip;
                        const result =
                            (mode !== 'CONNECTED' && icons.notConnected) ||
                            (clusterConnectivity[secret] !== 'OPERATIONAL' && icons.notOperational) ||
                            icons.connected;

                        return { result, address, name };
                    })
            });
        }
    }
}

export default {
    viewModel: ServerCommunicationFormViewModel,
    template: template
};
