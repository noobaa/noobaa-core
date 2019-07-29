/* Copyright (C) 2016 NooBaa */

import template from './pool-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';
import { redirectOverlayDuration } from 'config';
import * as routes from 'routes';

class PoolPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    pool = ko.observable();
    selectedTab = ko.observable();
    redirecting = ko.observable();

    selectState(state) {
        const { location, hostPools } = state;
        return [
            location,
            hostPools
        ];
    }

    mapStateToProps(location, pools) {
        const { system, pool, tab = 'nodes' } = location.params;
        if (!pool) return;

        // In case the pool does not exists
        if (pools && !pools[pool]) {
            this.redirectToResourcePage(system);
            return;
        }

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system, pool }, {}, true),
            pool: pool,
            selectedTab: tab
        });
    }

    redirectToResourcePage(system) {
        this.redirecting(true);
        setTimeout(() => {
            const resourcePageUri = realizeUri(routes.resources, { system });
            this.dispatch(requestLocation(resourcePageUri));
        }, redirectOverlayDuration);

    }

    tabHref(tab) {
        return realizeUri(this.baseRoute(), { tab });
    }
}

export default {
    viewModel: PoolPanelViewModel,
    template: template
};
