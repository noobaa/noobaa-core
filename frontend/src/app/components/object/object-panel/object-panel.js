/* Copyright (C) 2016 NooBaa */

import template from './object-panel.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import { getObjectId } from 'utils/object-utils';
import { fetchObject, fetchObjectParts, dropObjectsView } from 'action-creators';
import { paginationPageSize } from 'config';
import ko from 'knockout';

class ObjectPanelViewModel extends ConnectableViewModel {
    viewName = this.constructor.name;
    baseRoute = ko.observable();
    objectId = ko.observable();
    selectedTab = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { route, params, query, hostname } = location;
        const { system, bucket, object, version, tab = 'properties' } = params;
        if (!object) return;

        ko.assignToProps(this, {
            baseRoute: realizeUri(route, { system, bucket, object, version }, {}, true),
            selectedTab: tab,
            objectId: getObjectId(bucket, object, version)
        });


        // Load/update the object/object parts info.
        this._fetchObjectInfo(
            bucket,
            object,
            version,
            hostname,
            Number(query.page || 0)
        );
    }

    tabHref(tab) {
        const route = this.baseRoute();
        return route ? realizeUri(route, { tab }) : '';
    }

    dispose() {
        this.dispatch(dropObjectsView(this.viewName));
        super.dispose();
    }

    _fetchObjectInfo(bucket, object, version, hostname, page) {
        const fetchObjectAction = fetchObject(
            this.viewName,
            bucket,
            object,
            version,
            hostname,
        );

        const fetchObjectPartsAction = fetchObjectParts({
            bucket,
            key: object,
            version,
            skip: page * paginationPageSize,
            limit: paginationPageSize
        });

        this.dispatch(
            fetchObjectAction,
            fetchObjectPartsAction
        );
    }
}

export default {
    viewModel: ObjectPanelViewModel,
    template: template
};
