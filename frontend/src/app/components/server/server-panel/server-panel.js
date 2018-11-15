/* Copyright (C) 2016 NooBaa */

import template from './server-panel.html';
import ConnectableViewModel from 'components/connectable';
import { summarizeServerIssues } from 'utils/cluster-utils';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, countBy } from 'utils/core-utils';
import { lastSegment } from 'utils/string-utils';
import ko from 'knockout';

const issuesToTabs = deepFreeze({
    debugMode: 'diagnostics',
    clusterConnectivity: 'communication',
    version: 'details',
    dnsNameResolution: 'details',
    dnsServers: 'details',
    proxy: 'details',
    phonehome: 'details',
    ntp: 'details',
    remoteSyslog: 'details',
    minRequirements: 'details'
});

class ServerPanelViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    system = ko.observable();
    selectedTab = ko.observable();
    serverSecret = ko.observable();
    baseRoute = ko.observable();
    issueCounters = {
        details: ko.observable(),
        diagnostics: ko.observable(),
        communication: ko.observable()
    };

    selectState(state) {
        const { location, system, topology = {} } = state;
        const { serverMinRequirements, servers } = topology;
        const serverSecret = lastSegment(location.params.server, '-');
        return [
            location,
            serverMinRequirements,
            servers && servers[serverSecret],
            system && system.version
        ];
    }

    mapStateToProps(location, minRequirements, server, version) {
        const { route, params } = location;
        const { system, server: serverName, tab = 'details' } = params;
        if (!serverName || !server) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const issues = summarizeServerIssues(server, version, minRequirements);
            ko.assignToProps(this, {
                dataReady: true,
                system,
                baseRoute: realizeUri(route, { system, server: serverName }, {}, true),
                selectedTab: tab,
                serverSecret: server.secret,
                issueCounters: countBy(
                    Object.keys(issues),
                    key => issuesToTabs[key]
                )
            });
        }
    }

    tabHref(tab) {
        const route = this.baseRoute();
        if (route) {
            return realizeUri(route, { tab });
        }
    }
}

export default {
    viewModel: ServerPanelViewModel,
    template: template
};
