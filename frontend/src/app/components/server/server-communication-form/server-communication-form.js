/* Copyright (C) 2016 NooBaa */

import template from './server-communication-form.html';
import BaseViewModel from 'components/base-view-model';
import TestResultRowViewModel from './test-result-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze, keyByProperty } from 'utils/core-utils';

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

class ServerCommunicationFormViewModel extends BaseViewModel {
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
    }

    createServerRow(server) {
        return new TestResultRowViewModel(server, this.testResults);
    }
}

export default {
    viewModel: ServerCommunicationFormViewModel,
    template: template
};
