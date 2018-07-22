/* Copyright (C) 2016 NooBaa */

import template from './resource-connected-buckets-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, memoize } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getUsageDistribution, getResourceTypeDisplayName } from 'utils/resource-utils';
import { requestLocation } from 'action-creators';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';

const viewOptions = deepFreeze([
    {
        icon: 'list',
        value: 'TABLE'
    },
    {
        icon: 'pie',
        value: 'CHART'
    }
]);

class ResourceConnectedBucketsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    viewOptions = viewOptions;
    pathname = '';
    subject = ko.observable();
    resourceType = ko.observable();
    resourceName = ko.observable();
    bucketCount = ko.observable();
    lastUpdateTime = ko.observable();
    selectedView = ko.observable();

    selectUsageDistribution = memoize((resourceType, resourceName, buckets) => {
        return buckets && getUsageDistribution(resourceType, resourceName, buckets);
    });

    selectState(state, params) {
        const { resourceType, resourceName } = params;
        const { query, pathname } = state.location;

        const usageDistribution = this.selectUsageDistribution(
            resourceType,
            resourceName,
            state.buckets
        );

        return [
            resourceType,
            resourceName,
            usageDistribution,
            query.view || viewOptions[0].value,
            pathname
        ];
    }

    mapStateToProps(
        resourceType,
        resourceName,
        usageDistribution,
        selectedView,
        pathname
    ) {
        if (!usageDistribution) {
            ko.assignToProps(this, {
                dataReady: false,
                subject: getResourceTypeDisplayName(resourceType),
                bucketCount: '',
                selectedView: selectedView
            });

        } else {
            const lastUpdateTime = usageDistribution
                .map(record => record.lastUpdate)
                .reduce((t1, t2) => Math.min(t1, t2), Date.now());

            ko.assignToProps(this, {
                dataReady: true,
                resourceType: resourceType,
                resourceName: resourceName,
                subject: getResourceTypeDisplayName(resourceType),
                selectedView: selectedView,
                pathname: pathname,
                bucketCount: numeral(usageDistribution.length).format(','),
                lastUpdateTime: moment(lastUpdateTime).fromNow()
            });
        }
    }

    onView(view) {
        const url = realizeUri(this.pathname, null, { view });
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: ResourceConnectedBucketsFormViewModel,
    template: template
};
