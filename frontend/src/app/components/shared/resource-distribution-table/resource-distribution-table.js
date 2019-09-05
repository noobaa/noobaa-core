/* Copyright (C) 2016 NooBaa */

import template from './resource-distribution-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, memoize, createCompareFunc, decimalRound } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { getUsageDistribution, getResourceTypeDisplayName } from 'utils/resource-utils';
import { paginationPageSize } from 'config';
import { requestLocation } from 'action-creators';
import numeral from 'numeral';
import * as routes from 'routes';

const waitingToBeWipedWarning = 'The bucket is no longer using this resource as storage and it is currently wiping it’s stored data. Once done, it will not be shown as a connected bucket.';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'Bucket Name',
        type: 'link',
        sortable: true,
        compareKey: item => item.name
    },
    {
        name: 'usage',
        sortable: true,
        type: 'usage',
        compareKey: item => item.reason
    },
    {
        name: 'distribution',
        label: 'Usage Distribution',
        sortable: true,
        compareKey: item => item.ratio
    }
]);

function _formatRatio(ratio) {
    const rounded = decimalRound(ratio, 3);
    return numeral(rounded).format(Number.isInteger(rounded * 100) ? '%' : '0.0%');
}

class BucketRowViewModel {
    name = ko.observable();
    usage = ko.observable();
    distribution = ko.observable();
}

class ResourceDistributionTableViewModel extends ConnectableViewModel {
    columns = columns;
    pathname = '';
    dataLoaded = ko.observable();
    bucketCount = ko.observable();
    page = ko.observable();
    pageSize = ko.observable();
    sorting = ko.observable();
    emptyMessage = ko.observable();
    rows = ko.observableArray()
        .ofType(BucketRowViewModel)

    selectUsageDistribution = memoize((resourceType, resourceName, buckets) => {
        return buckets && getUsageDistribution(resourceType, resourceName, buckets);
    });

    selectState(state, params) {
        const usageDistribution = this.selectUsageDistribution(
            params.resourceType,
            params.resourceName,
            state.buckets
        );

        return [
            params.resourceType,
            usageDistribution,
            state.location
        ];
    }

    mapStateToProps(resourceType, usageDistribution, location) {
        const { params, query, pathname } = location;

        const { system, tab } = params;
        if (tab && tab !== 'connected-buckets' || !usageDistribution) {
            ko.assignToProps(this, { dataLoaded: false });

        } else {
            const subject = getResourceTypeDisplayName(resourceType);
            const sortBy = query.sortBy || 'name';
            const order = Number(query.order) || 1;
            const page = Number(query.page) || 0;
            const pageSize = Number(query.pageSize) || paginationPageSize.default;
            const pageStart = page * pageSize;
            const { compareKey } = columns.find(column => column.name === sortBy);

            // Clone the array on order to prevent inline sort.
            const usageList = Array.from(usageDistribution)
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + pageSize);

            ko.assignToProps(this, {
                dataLoaded: true,
                pathname,
                page,
                pageSize,
                sorting: { sortBy, order },
                bucketCount: usageDistribution.length,
                emptyMessage: `No associated buckets for this ${subject}`,
                rows: usageList.map(record => {
                    const { bucket, size, ratio, reason } = record;
                    const href = realizeUri(routes.bucket, { system, bucket});
                    const usageWarning = reason === 'WAITING_TO_BE_WIPED' ?
                        waitingToBeWipedWarning :
                        '';

                    return {
                        name : { text: bucket, href },
                        usage: { size: formatSize(size), usageWarning },
                        distribution: _formatRatio(ratio)
                    };
                })
            });
        }
    }

    onPage(page) {
        this._query({ page });
    }

    onPageSize(pageSize) {
        this._query({
            pageSize,
            page: 0
        });
    }

    onSort(sorting) {
        this._query(sorting);
    }

    _query(params) {
        const {
            page = this.page(),
            pageSize = this.pageSize(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order
        } = params;

        const url = realizeUri(this.pathname, null, { page, pageSize, sortBy, order });
        this.dispatch(requestLocation(url));
    }

}

export default {
    viewModel: ResourceDistributionTableViewModel,
    template: template
};
