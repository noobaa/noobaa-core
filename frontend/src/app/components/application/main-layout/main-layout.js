/* Copyright (C) 2016 NooBaa */

import template from './main-layout.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { registerForAlerts } from 'actions';
import { sessionInfo } from 'model';
import * as routes from 'routes';

const navItems = deepFreeze([
    /*{
        name: 'name',
        route: routes.<route>, (see routes.js)
        icon: 'icon',
        label: 'label', (display name, optional)
        beta: true/false, (show beta label)
        preview: true/false (hide when browser not in preview mode)
    },*/
    {
        name: 'overview',
        route: routes.system,
        icon: 'overview',
        label: 'Overview'
    },
    {
        name: 'resources',
        route: routes.pools,
        icon: 'resources',
        label: 'Resources'
    },
    {
        name: 'buckets',
        route: routes.buckets,
        icon: 'buckets',
        label: 'Buckets'
    },
    {
        name: 'funcs',
        route: routes.funcs,
        icon: 'functions',
        label: 'Functions',
        beta: true
    },
    {
        name: 'cluster',
        route: routes.cluster,
        icon: 'cluster',
        label: 'Cluster'
    },
    {
        name: 'management',
        route: routes.management,
        icon: 'manage',
        label: 'Management'
    }
]);

class MainLayoutViewModel extends Observer {
    constructor() {
        super();

        this.navItems = navItems.map(
            item => ({
                ...item,
                url: realizeUri(item.route, { system: sessionInfo().system })
            })
        );
        this.breadcrumbs = ko.observable([]);
        this.area = ko.observable();
        this.panel = ko.observable('');
        this.isUploadButtonVisible = ko.observable(false);


        this.observe(state$.get('layout'), this.onLayout);
        this.observe(state$.get('accounts', sessionInfo().user), this.onAccount);
        registerForAlerts();
    }

    onLayout(layout) {
        const { breadcrumbs, area, panel } = layout;

        this.breadcrumbs(breadcrumbs);
        this.area(area);
        this.panel(panel ? `${panel}-panel` : 'empty');

    }

    onAccount(account) {
        this.isUploadButtonVisible(account && account.isOwner);
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
