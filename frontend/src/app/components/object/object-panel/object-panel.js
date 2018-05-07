/* Copyright (C) 2016 NooBaa */

import template from './object-panel.html';
import Observer from 'observer';
import { realizeUri } from 'utils/browser-utils';
import { get } from 'rx-extensions';
import { state$, action$ } from 'state';
import { fetchObjects, dropObjectsView } from 'action-creators';
import ko from 'knockout';

class ObjectPanelViewModel extends Observer {
    viewName = this.constructor.name;
    baseRoute = '';
    bucket = ko.observable();
    object = ko.observable();
    selectedTab = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(get('location')),
            this.onState
        );
    }

    onState(location) {
        const { route, params, hostname } = location;
        const { system, bucket, object, tab = 'parts' } = params;
        if (!object) return;

        this.baseRoute = realizeUri(route, { system, bucket, object }, {}, true);
        this.selectedTab(tab);
        this.bucket(bucket);
        this.object(object);

        // Load/update the object data.
        action$.next(fetchObjects(this.viewName, { bucket, object }, hostname));
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }

    dispose() {
        action$.next(dropObjectsView(this.viewName));
        super.dispose();
    }
}

export default {
    viewModel: ObjectPanelViewModel,
    template: template
};
