/* Copyright (C) 2016 NooBaa */

import template from './func-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { funcInfo } from 'model';
import { realizeUri } from 'utils/browser-utils';
import { get } from 'rx-extensions';

class FuncPanelViewModel extends Observer {
    constructor() {
        super();

        this.func = funcInfo;
        this.selectedTab = ko.observable();
        this.baseRoute = '';
        this.funcName = ko.observable();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation({ route, params }) {
        const { system, func, tab = 'monitoring' } = params;

        this.baseRoute = realizeUri(route, { system, func }, {}, true);
        this.selectedTab(tab);
        this.funcName(func);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: FuncPanelViewModel,
    template: template
};
