/* Copyright (C) 2016 NooBaa */

import template from './object-panel.html';
import Observer from 'observer';
import { realizeUri } from 'utils/browser-utils';
import { getObjectId } from 'utils/object-utils';
import { get } from 'rx-extensions';
import { state$, action$ } from 'state';
import { fetchObject, fetchObjectParts, dropObjectsView } from 'action-creators';
import { paginationPageSize } from 'config';
import ko from 'knockout';

class ObjectPanelViewModel extends Observer {
    viewName = this.constructor.name;
    baseRoute = '';
    objectId = ko.observable();
    selectedTab = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(get('location')),
            this.onState
        );
    }

    onState(location) {
        const { route, params, query, hostname } = location;
        const { system, bucket, object, version, tab = 'properties' } = params;
        if (!object) return;

        this.baseRoute = realizeUri(route, { system, bucket, object, version }, {}, true);
        this.selectedTab(tab);
        this.objectId(getObjectId(bucket, object, version));

        // Load/update the object data.
        action$.next(fetchObject(this.viewName, bucket, object, version, hostname));

        // Load/update object parts data.
        action$.next(fetchObjectParts({
            bucket,
            key: object,
            version,
            skip: (Number(query.page) || 0) * paginationPageSize,
            limit: paginationPageSize
        }));
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
