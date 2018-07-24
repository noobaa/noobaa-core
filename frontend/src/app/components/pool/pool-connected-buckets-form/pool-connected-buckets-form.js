/* Copyright (C) 2016 NooBaa */

import template from './pool-connected-buckets-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { deepFreeze, memoize } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getUsageDistribution } from 'utils/resource-utils';
import { requestLocation } from 'action-creators';

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

class PoolConnectedBucketsFormViewModel extends ConnectableViewModel {
    viewOptions = viewOptions;
    pathname = '';
    poolName = ko.observable();
    dataLoaded = ko.observable();
    bucketCount = ko.observable();
    lastUpdateTime = ko.observable();
    selectedView = ko.observable();

    selectUsageDistribution = memoize((pool, buckets) => {
        return pool ? getUsageDistribution('HOSTS', pool.name, buckets) : [];
    });

    selectState(state, params) {
        const { hostPools = {}, buckets = {}, location } = state;
        const pool = hostPools[params.poolName];
        const usageDistribution = this.selectUsageDistribution(pool, buckets);

        return [
            pool,
            usageDistribution,
            location.query.view || viewOptions[0].value,
            location.pathname
        ];
    }

    mapStateToProps(pool, usageDistribution, selectedView, pathname) {
        if (!pool) {
            ko.assignToProps(this, {
                dataLoaded: false,
                bucketCount: '',
                selectedView: selectedView
            });

        } else {
            const lastUpdateTime = usageDistribution
                .map(record => record.lastUpdate)
                .reduce((t1, t2) => Math.min(t1, t2), Date.now());

            ko.assignToProps(this, {
                dataLoaded: true,
                poolName: pool.name,
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
    viewModel: PoolConnectedBucketsFormViewModel,
    template: template
};
