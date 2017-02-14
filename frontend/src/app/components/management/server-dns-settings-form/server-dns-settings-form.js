import template from './server-dns-settings-form.html';
import BaseViewModel from 'components/base-view-model';
import ServerRow from './server-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'serverName'
    },
    {
        name: 'address',
        label:'IP Address'
    },
    {
        name: 'primaryDNS'
    },
    {
        name: 'secondaryDNS'
    },
    {
        name: 'actions',
        label: '',
        type: 'button'
    }
]);

class ServerDnsSettingsFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;

        this.columns = columns;
        this.servers = [];

        const cluster = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster
        );

        this.servers = ko.pureComputed(
            () => cluster() ? cluster().shards[0].servers : []
        );

        const masterDNSServers = ko.pureComputed(
            () => {
                const master = this.servers().find(
                    server => server.secret === (cluster() || {}).master_secret
                );

                return (master && master.dns_servers) || [];
            }
        );

        this.masterPrimaryDNS = ko.observableWithDefault(
            () => masterDNSServers()[0]
        );

        this.masterSecondaryDNS = ko.observableWithDefault(
            () => masterDNSServers()[1]
        );
    }

    createRow(server) {
        return new ServerRow(server,);
    }
}

export default {
    viewModel: ServerDnsSettingsFormViewModel,
    template: template
};
