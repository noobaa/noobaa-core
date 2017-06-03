/* Copyright (C) 2016 NooBaa */

import template from './overview-panel.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';
import ko from 'knockout';

class OverviewPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedResourceType = ko.observable();
        this.selectedDuration = ko.observable();

        this.observe(state$.get('location'), this.onState);
    }

    onState({ route, params, query }) {
        const { system } = params;
        const { resourceType = 'HOSTS', duration = 'DAY' } = query;

        this.selectedResourceType(resourceType);
        this.selectedDuration(duration);
        this.baseRoute = realizeUri(route, { system }, {}, true);
    }

    onResourceType(resourceType) {
        const uri = realizeUri(this.baseRoute, {}, {
            resourceType,
            duration: this.selectedDuration()
        });
        action$.onNext(requestLocation(uri));
    }

    onDuration(duration) {
        const uri = realizeUri(this.baseRoute, {}, {
            resourceType: this.selectedResourceType(),
            duration
        });
        action$.onNext(requestLocation(uri));
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
