/* Copyright (C) 2016 NooBaa */

import template from './resource-distribution-chart.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, sumBy, makeArray, memoize, decimalRound } from 'utils/core-utils';
import { getUsageDistribution } from 'utils/resource-utils';
import numeral from 'numeral';

const maxChartValues = 6;
const colors = deepFreeze([
    'rgb(var(--color20))',
    'rgb(var(--color28))',
    'rgb(var(--color30))',
    'rgb(var(--color26))',
    'rgb(var(--color27))',
    'rgb(var(--color17))'
]);

function _formatRatio(ratio) {
    const rounded = decimalRound(ratio, 3);
    return numeral(rounded).format(Number.isInteger(rounded * 100) ? '%' : '0.0%');
}

class ResourceDistributionChartViewModel extends ConnectableViewModel {
    formatRatio = _formatRatio;
    dataReady = ko.observable();
    chartValues = makeArray(maxChartValues, i => ({
        value: ko.observable(),
        color: colors[i],
        label: ko.observable(),
        visible: ko.observable(),
        tooltip: ko.observable()
    }));

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
            usageDistribution
        ];
    }

    mapStateToProps(usageDistribution) {
        if (!usageDistribution) {
            ko.assignToProps(this, { dataReady: false });

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
                    const label = visible ? `Other buckets (${other.length})` : '';
                    const tooltip = {
                        template: 'propertySheet',
                        text: other.map(item => ({
                            label: item.bucket,
                            value: _formatRatio(item.ratio)
                        }))
                    };

                    return { value, label, visible, tooltip };
                }
            });

            ko.assignToProps(this, {
                dataReady: true,
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
    viewModel: ResourceDistributionChartViewModel,
    template: template
};
