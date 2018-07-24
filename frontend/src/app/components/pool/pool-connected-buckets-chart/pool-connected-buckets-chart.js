/* Copyright (C) 2016 NooBaa */

import template from './pool-connected-buckets-chart.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, sumBy, makeArray, memoize, decimalRound } from 'utils/core-utils';
import { getUsageDistribution } from 'utils/resource-utils';
import style from 'style';
import numeral from 'numeral';

const maxChartValues = 6;
const colors = deepFreeze([
    style['color16'],
    style['color14'],
    style['color13'],
    style['color18'],
    style['color7'],
    style['color6']
]);

class PoolConnectedBucketsGraphViewModel2 extends ConnectableViewModel {
    dataLoaded = ko.observable();
    chartValues = makeArray(maxChartValues, i => ({
        value: ko.observable(),
        color: colors[i],
        label: ko.observable(),
        visible: ko.observable()
    }));

    selectUsageDistribution = memoize((pool, buckets) => {
        return pool ? getUsageDistribution('HOSTS', pool.name, buckets) : [];
    });

    selectState(state, params) {
        const { hostPools = {}, buckets } = state;
        const pool = hostPools[params.poolName];
        const usageDistribution = this.selectUsageDistribution(pool, buckets);

        return [
            pool,
            usageDistribution
        ];
    }

    mapStateToProps(pool, usageDistribution) {
        if (!pool) {
            ko.assignToProps(this, { dataLoaded: false });

        } else {
            const orderedByUsage = Array.from(usageDistribution)
                .sort((b1, b2) => b2.ratio - b1.ratio);

            const chartValues = makeArray(maxChartValues, i => {
                if (i < maxChartValues - 1 || orderedByUsage.length === maxChartValues) {
                    const record = orderedByUsage[i];
                    const value = record ? record.ratio : 0;
                    const label = record ? record.bucket : '';
                    const visible = Boolean(record);
                    return { value, label, visible };

                } else {
                    const other = orderedByUsage.slice(maxChartValues - 1);
                    const visible = other.length > 0;
                    const value = visible ? sumBy(other, bucket => bucket.ratio) : 0;
                    const label = visible ? `Other buckets (${other.length})` : 0;
                    return { value, label, visible };
                }
            });

            ko.assignToProps(this, {
                dataLoaded: true,
                chartValues: chartValues
            });
        }
    }

    formatRatio(ratio) {
        const rounded = decimalRound(ratio, 3);
        return numeral(rounded).format(Number.isInteger(rounded * 100) ? '%' : '0.0%');
    }
}

export default {
    viewModel: PoolConnectedBucketsGraphViewModel2,
    template: template
};
