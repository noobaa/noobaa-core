/* Copyright (C) 2016 NooBaa */

import template from './bucket-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { uiState, systemInfo, routeContext, bucketObjectList } from 'model';
import { loadBucketObjectList } from 'actions';

class BucketPanelViewModel extends Observer {
    constructor() {
        super();

        this.bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                ({ name }) => routeContext().params.bucket === name
            )
        );

        this.objectList = bucketObjectList;

        this.ready = ko.pureComputed(
            () => !!this.bucket()
        );

        this.bucketName = ko.pureComputed(
            () => this.bucket() && this.bucket().name
        );

        if(routeContext()) this.onRoute(routeContext());
        this.observe(routeContext, this.onRoute);
    }

    tabHref(tab) {
        return {
            route: 'bucket',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: uiState().tab === tab
        };
    }

    onRoute({ params, query }) {
        const { bucket, tab } = params;

        if (tab === 'objects') {
            const { filter, sortBy = 'key', order = 1, page = 0 } = query;

            loadBucketObjectList(bucket, filter, sortBy, parseInt(order), parseInt(page));
        }
    }

}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
