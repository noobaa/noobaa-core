/* Copyright (C) 2016 NooBaa */

import template from './host-panel.html';
import Observer  from 'observer';
import { state$, action$ } from 'state';
import { fetchHosts, fetchHostObjects, dropHostsView, requestLocation } from 'action-creators';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { sleep } from 'utils/promise-utils';
import { get } from 'rx-extensions';
import * as routes from 'routes';
import { redirectOverlayDuration } from 'config';
import { paginationPageSize } from 'config';

const viewName = 'hostPanel';

class HostPanelViewModel extends Observer {
    constructor() {
        super();

        this.poolRedirectPath = '';
        this.basePath = '';
        this.host = ko.observable();
        this.selectedTab = ko.observable();
        this.redirecting = ko.observable();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
        this.observe(
            state$.pipe(get('hosts')),
            this.onHosts
        );
    }

    onLocation(location) {
        const { route, params, query } = location;
        const { system, pool, host, tab = 'details' } = params;
        if (!host) return;

        this.host(host);
        this.poolRedirectPath = realizeUri(routes.pool, { system, pool });
        this.basePath = realizeUri(route, { system, pool, host }, {}, true);
        this.selectedTab(tab);

        // Load/update the host data.
        action$.next(fetchHosts(viewName, { hosts: [host] }, true));

        // load the host object list.
        if (tab === 'parts') {
            action$.next(fetchHostObjects(
                params.host,
                Number(query.page || 0) * paginationPageSize,
                paginationPageSize
            ));
        }
    }

    async onHosts(hosts) {
        const queryKey = hosts.views[viewName];
        const { [queryKey]: query } = hosts.queries;

        if (query && !query.fetching && query.result.items.length === 0) {
            this.redirecting(true);
            await sleep(redirectOverlayDuration);
            action$.next(requestLocation(this.poolRedirectPath));

        } else {
            this.redirecting(false);
        }
    }

    tabHref(tab) {
        return realizeUri(this.basePath, { tab });
    }

    dispose() {
        action$.next(dropHostsView(viewName));
        super.dispose();
    }
}

export default {
    viewModel: HostPanelViewModel,
    template: template
};
