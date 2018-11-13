/* Copyright (C) 2016 NooBaa */

import template from './main-layout.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { registerForAlerts } from 'actions';
import * as routes from 'routes';
import routeMapping from './route-mapping';
import { get, getMany } from 'rx-extensions';
import {
    fetchSystemInfo,
    openFinalizeUpgradeModal,
    openWelcomeModal
} from 'action-creators';

const navItems = deepFreeze([
    /*{
        route: 'route name', (see routes.js)
        icon: 'icon',
        label: 'label', (display name, optional)
        beta: true/false, (shows a beta label)
        preview: true/false (hide when browser not in preview mode)
    },*/
    {
        route: 'system',
        icon: 'overview',
        label: 'Overview'
    },
    {
        route: 'resources',
        icon: 'resources',
        label: 'Resources'
    },
    {
        route: 'buckets',
        icon: 'buckets',
        label: 'Buckets'
    },
    {
        route: 'funcs',
        icon: 'functions',
        label: 'Functions'
    },
    {
        route: 'cluster',
        icon: 'cluster',
        label: 'Cluster'
    },
    {
        route: 'management',
        icon: 'manage',
        label: 'Management'
    },
    {
        route: 'accounts',
        icon: 'accounts',
        label: 'Accounts'
    },
    {
        route: 'analytics',
        icon: 'line-chart',
        label: 'Analytics',
        beta: true
    }
]);

function _mapNavItem(item) {
    const { icon, label, beta, preview, route: name } = item;
    const url = ko.observable();
    return { name, url, icon, label, beta, preview };
}

class MainLayoutViewModel extends Observer {
    constructor() {
        super();

        this.logoHref = ko.observable();
        this.navItems = navItems.map(_mapNavItem);
        this.breadcrumbs = ko.observableArray();
        this.area = ko.observable();
        this.panel = ko.observable();
        this.isUploadButtonVisible = ko.observable(false);

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    ['session', 'user']
                )
            ),
            this.onAccount
        );

        registerForAlerts();
    }

    onLocation(location) {
        const { route, params, query } = location;
        const { system } = params;
        const { panel, area, crumbsGenerator } = routeMapping[route] || {};

        this.logoHref(realizeUri(routes.system, { system }));
        this.breadcrumbs(crumbsGenerator(params));
        this.navItems.forEach(item => item.url(realizeUri(routes[item.name], { system })));
        this.area(area);
        this.panel(panel ? `${panel}-panel` : 'empty');

        const { afterupgrade, welcome } = query;
        if (afterupgrade) {
            action$.next(openFinalizeUpgradeModal());

        } else if (welcome) {
            action$.next(openWelcomeModal());
        }

        action$.next(fetchSystemInfo());
    }

    onAccount([ accounts, user ]) {
        if (!accounts || !user) return;
        const account = accounts[user];
        this.isUploadButtonVisible(account && account.isOwner);
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
