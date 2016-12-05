import template from './unable-to-activate-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { support } from 'config';
import { serverInfo } from 'model';
import { loadServerInfo } from 'actions';
import { deepFreeze } from 'utils/all';

const messages = deepFreeze({
    CANNOT_REACH_DNS_SERVER: 'DNS server unreachable, please verify that the DNS server address is correct or use the first installation wizard to update.',
    CANNOT_RESOLVE_PHONEHOME_NAME: 'Cannot resolve <span class="highlight">phonehome.noobaa.com</span>, please verify that your DNS server can resolve public names.',
    CANNOT_CONNECT_INTERNET: 'Cannot connect to the internet, please verify that your internet connection settings are correct and then retry.',
    CANNOT_CONNECT_PHONEHOME_SERVER: 'Cannot connect to <span class="highlight">phonehome.noobaa.com</span>, please verify that your internet connection settings are correct and then retry.',
    MALFORMED_RESPONSE: 'Malformed response, this may be the result of using a proxy. Try to configure direct access for the create system process (after activation you can reactivate the proxy)'
});

class UnableToActivateModalViewModel extends Disposable {
    constructor() {
        super();

        let config = ko.pureComputed(
            () => serverInfo().config
        );

        this.message = ko.pureComputed(
            () => messages[config().phone_home_connectivity_status]
        );

        let ipAssigment = ko.pureComputed(
            () => config().using_dhcp ? 'Dynamic (DHCP)' : 'Static'
        );

        let serverAddress = ko.pureComputed(
            () => serverInfo().address
        );

        let dnsServers = ko.pureComputed(
            () => config().dns_servers || []
        );

        let primaryDNSServer = ko.pureComputed(
            () => dnsServers()[0] || 'Not set'
        );

        let secondaryDNSServer = ko.pureComputed(
            () => dnsServers()[1] || 'Not set'
        );

        this.networkDetails = [
            {
                label: 'IP Assignment',
                value: ipAssigment
            },
            {
                label: 'Server Address',
                value: serverAddress
            },
            {
                label: 'Primary DNS Server',
                value: primaryDNSServer
            },
            {
                label: 'Secondary DNS Server',
                value: secondaryDNSServer
            }
        ];


        this.supportEmailUrl = `mailto:${support.email}`;
    }

    retry() {
        loadServerInfo();
    }
}

export default {
    viewModel: UnableToActivateModalViewModel,
    template: template
};
