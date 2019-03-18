/* Copyright (C) 2016 NooBaa */

import template from './analytics-resource-distribution-form.html';
import ConnectableViewModel from 'components/connectable';
import { shortString } from 'utils/string-utils';
import { deepFreeze, makeArray, memoize, createCompareFunc, sumBy } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { getCloudResourceTypeIcon, getUsageDistribution } from 'utils/resource-utils';
import { requestLocation } from 'action-creators';
import ko from 'knockout';
import themes from 'themes';
import moment from 'moment';
import numeral from 'numeral';

const MIN_COL_COUNT = 4;
const MAX_COL_COUNT = 6;

const hostsIcon = {
    name: 'nodes-pool'
};

const placeholderBar = {
    label: {
        text: '',
        tooltipTitle: '',
        tooltipBody: ''
    },
    value: 0
};

const options = deepFreeze({
    scales: {
        yAxes: [{
            scaleLabel: {
                display: true,
                labelString: 'Raw Usage'
            },
            ticks: {
                // Using space for visual padding.
                callback: size => `${
                    size && formatSize(Math.round(size))
                }${
                    ' '.repeat(5)
                }`
            }
        }],
        xAxes: [{
            gridLines: {
                display: false
            },
            ticks: {
                callback: label => label.text
            }
        }]
    },
    tooltips: {
        position: 'nearest',
        displayColors: false,
        custom: tooltip => {
            if (!tooltip.title || tooltip.title.length === 0) {
                tooltip.opacity = 0;
            }
        },
        callbacks: {
            title: (items, data) => data.labels[items[0].index].tooltipTitle,
            label: (item, data) => data.labels[item.index].tooltipBody
        }
    }
});

const compareDistributionRecords = createCompareFunc(
    record => record.size,
    -1
);

function _getResourceIcon(resource) {
    if (resource.type == 'HOSTS') {
        return { icon: hostsIcon };

    } else if (resource.type === 'CLOUD') {
        const { name: icon } = getCloudResourceTypeIcon({ type: resource.cloudType });
        return { icon: `${icon}` };
    }

}

function _getResourceOption(resource) {
    const { icon, selectedIcon } = _getResourceIcon(resource);
    return {
        value: `${resource.type}:${resource.name}`,
        label: resource.name,
        icon: icon,
        selectedIcon: selectedIcon
    };
}

function _getDistributionBars(distribution) {
    const len = distribution.length;
    const bars = [];

    const bucketBarsCount = len <= MAX_COL_COUNT ? len : MAX_COL_COUNT - 1;
    bars.push(
        ...distribution.slice(0, bucketBarsCount).map(record => ({
            label: {
                text: shortString(record.bucket, 16, 0),
                tooltipTitle: record.bucket,
                tooltipBody: `Raw Usage: ${formatSize(record.size)}`
            },
            value: record.size
        }))
    );

    if (len < MIN_COL_COUNT) {
        bars.push(...makeArray(
            MIN_COL_COUNT - len,
            () => placeholderBar
        ));

    } else if (len > MAX_COL_COUNT) {
        const others = distribution.slice(MAX_COL_COUNT - 1);
        const size = sumBy(others, record => record.size);
        const label = `Other Buckets (${numeral(others.length).format(',')})`;
        const list = others.map(record => `${
            record.bucket
        }: ${
            formatSize(record.size)
        }`);

        bars.push({
            label: {
                text: label,
                tooltipTitle: label,
                tooltipBody: [
                    ...list,
                    `Total Usage: ${formatSize(size)}`
                ]
            },
            value: size
        });
    }

    return bars;
}

class AnalyticsPanelViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    pathname = '';
    resourceOptions = ko.observable();
    lastUpdateTime = ko.observable();
    selectedResource = ko.observable();
    barsIsEmpty = ko.observable();
    barsOptions = options;
    barsData = {
        labels: ko.observableArray(),
        datasets: ko.observableArray()
    };


    selectResources = memoize((hostPools, cloudResource) => {
        if (!hostPools || !cloudResource) {
            return;
        }

        return [
            ...Object.values(hostPools).map(pool => ({
                type: 'HOSTS',
                name: pool.name
            })),
            ...Object.values(cloudResource).map(res => ({
                type: 'CLOUD',
                name: res.name,
                cloudType: res.type
            }))
        ];
    });

    selectUsageDistirbution = memoize((resType, resName, buckets) => {
        return getUsageDistribution(resType, resName, buckets)
            .sort(compareDistributionRecords);
    });

    selectState(state) {
        const { location, hostPools, cloudResources, buckets, session } = state;
        const resources = this.selectResources(hostPools, cloudResources);
        const first = resources && resources[0];
        const {
            resourceType = first && first.type,
            resourceName = first && first.name
        } = location.query;

        const distribution = buckets && this.selectUsageDistirbution(
            resourceType,
            resourceName,
            buckets
        );

        const resourceId =
            resourceType &&
            resourceName &&
            `${resourceType}:${resourceName}`;

        return [
            resources,
            resourceId,
            distribution,
            location.pathname,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(resources, selectedResource, distribution, pathname, theme) {
        if (!resources || !distribution) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const resourceOptions = resources.map(_getResourceOption);
            const bars = _getDistributionBars(distribution);
            const lastUpdate = distribution.reduce(
                (lastUpdate, record) => Math.min(lastUpdate, record.lastUpdate),
                Date.now()
            );

            ko.assignToProps(this, {
                dataReady: true,
                pathname: pathname,
                resourceOptions: resourceOptions,
                lastUpdateTime: moment(lastUpdate).fromNow(),
                selectedResource: selectedResource,
                barsIsEmpty: distribution.length === 0,
                barsData: {
                    labels: bars.map(bar => bar.label),
                    datasets: [{
                        backgroundColor: theme.color20,
                        data: bars.map(bar => bar.value)
                    }]
                }
            });
        }
    }

    onSelectResource(resourceId) {
        const [resourceType, resourceName] = resourceId.split(':');
        const url = realizeUri(this.pathname, {}, { resourceType, resourceName });
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: AnalyticsPanelViewModel,
    template: template
};
