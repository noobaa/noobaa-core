/* Copyright (C) 2016 NooBaa */

import template from './server-panel.html';
import Observer from 'observer';
import { state$ } from 'state';
import { lastSegment } from 'utils/string-utils';
import { summarizeServerIssues } from 'utils/cluster-utils';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, sumBy, mapValues } from 'utils/core-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';

const tabsToIssues = deepFreeze({
    diagnostics: [
        'debugMode'
    ],
    communication: [
        'clusterConnectivity'
    ],
    details: [
        'version',
        'dnsNameResolution',
        'dnsServers',
        'proxy',
        'phonehome',
        'ntp',
        'remoteSyslog',
        'minRequirements'
    ]
});

class ServerPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.serverSecret = ko.observable();
        this.baseRoute = '';
        this.detailsIssues = ko.observable();
        this.diagnosticsIssues = ko.observable();
        this.communicationIssues = ko.observable();
        this.system = ko.observable();

        this.observe(
            state$.pipe(
                getMany(
                    'location',
                    'topology',
                    ['system', 'version']
                )
            ),
            this.onState
        );
    }

    onState([location,  topology, version]) {
        const { route, params } = location;
        const { system, server, tab = 'details' } = params;

        if (!server) return;
        this.system(system);
        this.baseRoute = realizeUri(route, { system, server }, {}, true);
        this.selectedTab(tab);
        this.serverSecret(server && lastSegment(server, '-'));

        if (!topology) return;
        const { servers, serverMinRequirements } = topology;
        const serverData = servers[this.serverSecret()];
        const issues = summarizeServerIssues(
            serverData,
            version,
            serverMinRequirements
        );

        const issuesCount = mapValues(
            tabsToIssues,
            keys => sumBy(keys, key => issues[key] ? 1 : 0)
        );

        this.diagnosticsIssues(issuesCount.diagnostics);
        this.communicationIssues(issuesCount.communication);
        this.detailsIssues(issuesCount.details);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: ServerPanelViewModel,
    template: template
};
