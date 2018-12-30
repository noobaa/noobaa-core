/* Copyright (C) 2016 NooBaa */

import template from './func-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class FuncPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();
    funcName = ko.observable();
    funcVersion = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { route, params } = location;
        const { system, func, tab = 'monitoring' } = params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(route, { system, func }, {}, true),
            selectedTab: tab,
            funcName: func,
            funcVersion: '$LATEST'
        });
    }

    tabHref(tab) {
        return this.baseRoute() ?
            realizeUri(this.baseRoute(), { tab }) :
            '';
    }
}

export default {
    viewModel: FuncPanelViewModel,
    template: template
};
