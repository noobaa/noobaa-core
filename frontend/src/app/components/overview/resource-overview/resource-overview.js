/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import ConnectableViewModel from 'components/connectable';
import { stringifyAmount} from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, sumBy, groupBy, countBy, flatMap } from 'utils/core-utils';
import * as routes from 'routes';
import { openAddResourcesModal } from 'action-creators';
import ko from 'knockout';
import themes from 'themes';
import numeral from 'numeral';

const chartBars = deepFreeze([
    {
        label: 'Pools',
        resourceType: 'HOSTS'
    },
    {
        label: 'AWS',
        resourceType: 'CLOUD',
        cloudTypes: [
            'AWS'
        ]
    },
    {
        label: 'Google',
        resourceType: 'CLOUD',
        cloudTypes: [
            'GOOGLE'
        ]
    },
    {
        label: 'Azure',
        resourceType: 'CLOUD',
        cloudTypes: [
            'AZURE'
        ]
    },
    {
        label: 'Other S3',
        resourceType: 'CLOUD',
        cloudTypes: [
            'S3_COMPATIBLE',
            'FLASHBLADE',
            'NET_STORAGE'
        ]
    }
]);

function _getHostsPoolState(pool) {
    return (
        (pool.mode === 'OPTIMAL' && 'healthy') ||
        (pool.mode === 'ALL_NODES_OFFLINE' && 'error') ||
        (pool.mode === 'HAS_NO_NODES' && 'error') ||
        (pool.mode === 'NO_CAPACITY' && 'error') ||
        (pool.mode === 'MOST_NODES_ISSUES' && 'error') ||
        (pool.mode === 'MOST_STORAGE_ISSUES' && 'error') ||
        (pool.mode === 'MOST_S3_ISSUES' && 'error') ||
        'issue'
    );
}

function _getCloudResourceState(resource) {
    return (
        (resource.mode === 'OPTIMAL' && 'healthy') ||
        (resource.mode === 'IO_ERRORS' && 'error') ||
        (resource.mode === 'STORAGE_NOT_EXIST' && 'error') ||
        (resource.mode === 'AUTH_FAILED' && 'error') ||
        (resource.mode === 'ALL_NODES_OFFLINE' && 'error') ||
        'issue'
    );
}

class ResourceOverviewViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    resourcesLink ={
        text: ko.observable(),
        href:  ko.observable()
    };
    resourceCounters = [
        {
            label: 'Healthy',
            color: 'rgb(var(--color27))',
            value: ko.observable()
        },
        {
            label: 'Issues',
            color: 'rgb(var(--color26))',
            value: ko.observable()
        },
        {
            label: 'Errors',
            color: 'rgb(var(--color31))',
            value: ko.observable()
        }
    ];
    chart = {
        options: {
            layout: {
                padding: 0
            },
            maintainAspectRatio: false,
            scales: {
                yAxes: [{
                    stacked: true,
                    ticks: {
                        suggestedMax: 5,
                        callback: (value, i, values) => {
                            const curr = Math.round(value);
                            const next = Math.round(values[i - 1]);
                            return curr !== next ?
                                `${numeral(curr).format(',')}${' '.repeat(5)}` :
                                null;
                        }
                    }
                }],
                xAxes: [{
                    stacked: true,
                    categoryPercentage: .5
                }]
            },
            tooltips: {
                position: 'nearest',
                mode: 'x',
                custom: tooltip => {
                    if (!tooltip.title || tooltip.title.length === 0) {
                        tooltip.opacity = 0;
                    }
                },
                callbacks: {
                    title: items => {
                        const count = sumBy(items, item => item.yLabel);
                        return items.some(item => item.yLabel > 0) ?
                            `${items[0].xLabel}: ${numeral(count).format(',')}`:
                            '';
                    },
                    label: item => `${
                        (item.datasetIndex === 2 && 'Healthy') ||
                        (item.datasetIndex === 1 && 'Issues') ||
                        (item.datasetIndex === 0 && 'Errors')
                    }: ${
                        numeral(item.yLabel).format(',')
                    }`
                }
            }
        },
        data: ko.observable()
    };

    selectState(state) {
        const { location, hostPools, cloudResources, session } = state;
        return [
            location,
            hostPools,
            cloudResources,
            session && themes[session.uiTheme]
        ];
    }

    mapStateToProps(location, hostPools, cloudResources, theme) {
        if (!hostPools || !cloudResources || !theme) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const hostPoolList = Object.values(hostPools);
            const cloudResourceList = Object.values(cloudResources);
            const resourceCount = hostPoolList.length + cloudResourceList.length;
            const cloudResourceByType = groupBy(cloudResourceList, res => res.type);

            const counters = chartBars
                .reduce((aggr, bar) => {
                    let counters = null;
                    if (bar.resourceType === 'HOSTS') {
                        counters = countBy(hostPoolList, _getHostsPoolState);

                    } else {
                        counters = countBy(
                            flatMap(
                                bar.cloudTypes,
                                cloudType => cloudResourceByType[cloudType]
                            ),
                            _getCloudResourceState
                        );
                    }


                    aggr.healthy.push(counters.healthy || 0);
                    aggr.issue.push(counters.issue || 0);
                    aggr.error.push(counters.error || 0);
                    return aggr;
                }, {
                    healthy: [],
                    issue: [],
                    error: []
                });

            const chartData = {
                labels: chartBars.map(bar => bar.label),
                datasets: [
                    {
                        backgroundColor: theme.color31,
                        data: counters.error
                    },
                    {
                        backgroundColor: theme.color26,
                        data: counters.issue
                    },
                    {
                        backgroundColor: theme.color27,
                        data: counters.healthy
                    }
                ]
            };

            ko.assignToProps(this, {
                dataReady: true,
                resourcesLink: {
                    text: stringifyAmount('resource', resourceCount),
                    href: realizeUri(
                        routes.resources,
                        { system: location.params.system }
                    )
                },
                resourceCounters: [
                    { value: sumBy(counters.healthy) },
                    { value: sumBy(counters.issue) },
                    { value: sumBy(counters.error) }
                ],
                chart: {
                    data: chartData
                }
            });
        }
    }

    onAddResources() {
        this.dispatch(openAddResourcesModal());
    }
}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
