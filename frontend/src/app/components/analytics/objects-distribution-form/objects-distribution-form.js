/* Copyright (C) 2016 NooBaa */

import template from './objects-distribution-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, sumBy, makeArray } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import themes from 'themes';
import numeral from 'numeral';
import {
    requestLocation,
    fetchObjectsDistribution
} from 'action-creators';

const barCount = 5;

const chartOptions = deepFreeze({
    scales: {
        yAxes: [{
            scaleLabel: {
                display: true,
                labelString: 'Number of Objects'
            },
            ticks: {
                callback: count => numeral(count).format('0,0')
            }
        }]
    },
    tooltips: {
        position: 'nearest',
        displayColors: false,
        callbacks: {
            label: item => `Number of Objects: ${numeral(item.yLabel).format('0,0')}`
        }
    }
});

function _perpareChartBars(distribution) {
    const step = Math.ceil(distribution.length / barCount);
    return makeArray(barCount, i => {
        const fromIndex  = i * step;
        const toIndex = fromIndex + step;
        const label = `${
            formatSize(fromIndex == 0 ? 0 : 2 ** (fromIndex - 1))
        } - ${
            formatSize(2 ** (toIndex - 1))
        }`;
        const value = sumBy(distribution.slice(fromIndex, toIndex), bin => bin.count);
        return { label, value };
    });
}

class BucketObjectsDistributionFormViewModel extends ConnectableViewModel {
    pathname = '';
    query = {};
    dataReady = ko.observable();
    bucketOptions = ko.observableArray();
    selectedBucket = ko.observable();
    chart = {
        type: 'bar',
        options: chartOptions,
        data: ko.observable()
    };

    constructor(...args) {
        super(...args);

        // Fetch bucket object distribution.
        this.dispatch(fetchObjectsDistribution());
    }

    selectState(state) {
        return [
            state.buckets,
            state.location,
            state.objectsDistribution,
            themes[state.session.uiTheme]
        ];
    }

    mapStateToProps(buckets, location, distributions, theme) {
        const { pathname, query } = location;

        if (!buckets || !distributions.buckets) {
            ko.assignToProps(this, {
                dataReady: false,
                query: query,
                pathname: pathname
            });

        } else {
            const bucketNames = Object.keys(buckets);
            const selectedBucket = query.bucket || bucketNames[0];
            const bars = _perpareChartBars(distributions.buckets[selectedBucket]);

            ko.assignToProps(this, {
                dataReady: true,
                query: query,
                pathname: pathname,
                selectedBucket: selectedBucket,
                bucketOptions: bucketNames,
                chart: {
                    data: {
                        labels: bars.map(bar => bar.label),
                        datasets: [{
                            backgroundColor: theme.color28,
                            data: bars.map(bar => bar.value)
                        }]
                    }
                }
            });
        }
    }

    onSelectBucket(bucket) {
        const url = realizeUri(this.pathname, {}, { ...this.query, bucket });
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: BucketObjectsDistributionFormViewModel,
    template: template
};
