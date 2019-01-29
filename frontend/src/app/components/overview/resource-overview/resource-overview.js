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
        label: 'Node Pools',
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
    (pool.mode === 'OPTIMAL' && 'healthy') ||
    (pool.mode === 'ALL_NODES_OFFLINE' && 'error') ||
    (pool.mode === 'HAS_NO_NODES' && 'error') ||
    (pool.mode === 'NO_CAPACITY' && 'error') ||
    (pool.mode === 'MOST_NODES_ISSUES' && 'error') ||
    (pool.mode === 'MOST_STORAGE_ISSUES' && 'error') ||
    (pool.mode === 'MOST_S3_ISSUES' && 'error') ||
    'issue';
}

function _getCloudResourceState(resource) {
    return (resource.mode === 'OPTIMAL' && 'healthy') ||
        (resource.mode === 'IO_ERRORS' && 'error') ||
        (resource.mode === 'STORAGE_NOT_EXIST' && 'error') ||
        (resource.mode === 'AUTH_FAILED' && 'error') ||
        (resource.mode === 'ALL_NODES_OFFLINE' && 'error') ||
        'issue';
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
            color: 'rgb(var(--color21))',
            value: ko.observable()
        },
        {
            label: 'Issues',
            color: 'rgb(var(--color20))',
            value: ko.observable()
        },
        {
            label: 'Errors',
            color: 'rgb(var(--color19))',
            value: ko.observable()
        }
    ];
    chart = {
        options: {
            maintainAspectRatio: false,
            scales: {
                yAxes: [{
                    stacked: true,
                    ticks: {
                        suggestedMax: 5,
                        display: false
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
                    title: (items) => items.some(item => item.yLabel > 0) ?
                        items[0].xLabel:
                        '',
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
        return [
            state.location,
            state.hostPools,
            state.cloudResources,
            themes[state.session.uiTheme]
        ];
    }

    mapStateToProps(location, hostPools, cloudResources, theme) {
        if (!hostPools || !cloudResources) {
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
                        backgroundColor: theme.color19,
                        data: counters.error
                    },
                    {
                        backgroundColor: theme.color20,
                        data: counters.issue
                    },
                    {
                        backgroundColor: theme.color21,
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
