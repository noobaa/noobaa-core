/* Copyright (C) 2016 NooBaa */

import template from './internal-resources-table.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';
import { getMany } from 'rx-extensions';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: ' Resource Name',
        sortable: true
    },
    {
        name: 'connectedBuckets',
        label: 'Buckets Using Resource',
        sortable: true
    },
    {
        name: 'capacity',
        type: 'capacity',
        label: 'Used for Spillover',
        sortable: true
    }
]);

class InternalResourcesTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.pageSize = paginationPageSize;
        this.pathname = '';
        this.resourcesLoaded = ko.observable();
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.page = ko.observable();
        this.resourceCount = ko.observable();
        this.rows = ko.observableArray();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.pipe(
                getMany(
                    'internalResources',
                    'buckets',
                    'location'
                )
            ),
            this.onResources
        );
    }

    onResources([ resources, buckets, location ]) {
        if (location.params.tab !== 'internal') {
            return;
        }

        if (!resources) {
            this.resourcesLoaded(false);
            return;
        }

        const { sortBy = 'name', order = 1, page = 0 } = location.query;
        const pageStart = Number(page) * this.pageSize;
        const resourceList = Object.values(resources);

        const bucketList = Object.values(buckets);
        const bucketsWithSpillover = bucketList
            .filter(bucket => bucket.spillover)
            .map(bucket => bucket.name);

        const rows = resourceList
            .slice(pageStart, pageStart + this.pageSize)
            .map((resource, i) => {
                const row = this.rows.get(i) || new ResourceRowViewModel();
                row.onResources(resource, bucketList.length, bucketsWithSpillover);
                return row;
            });

        this.pathname = location.pathname;
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.resourceCount(resourceList.length);
        this.rows(rows);
        this.resourcesLoaded(true);
    }

    onSort(sorting) {
        this._query({ sorting });
    }

    onPage(page) {
        this._query({ page });
    }

    _query(params) {
        const {
            sorting = this.sorting(),
            page = this.page()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            sortBy: sortBy,
            order: order,
            page: page
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }
}

export default {
    viewModel: InternalResourcesTableViewModel,
    template: template
};
