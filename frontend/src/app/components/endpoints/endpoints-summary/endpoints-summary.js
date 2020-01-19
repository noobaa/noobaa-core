/* Copyright (C) 2016 NooBaa */


import template from './endpoints-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { sumBy, makeArray } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import themes from 'themes';

class EndpointsSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable(true);
    groupCount = ko.observable();
    endpointCount = ko.observable();
    cpuUsage = ko.observable();
    memoryUsage = ko.observable();
    lastUpdate = ko.observable();
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
                        maxTicksLimit: 10,
                        suggestedMax: 10,
                        precision: 1,
                        stepSize: 2
                    }
                }],
                xAxes: [{
                    stacked: true,
                    ticks: {
                        callback: value => value.length > 10 ?
                            `${value.slice(0, 7)}...` :
                            value
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                mode: 'x',
                displayColors: false,
                callbacks: {
                    label: item => stringifyAmount('Endpoint', item.yLabel)
                }
            }
        },
        data: ko.observable()
    };

    selectState(state) {
        const { endpointGroups, session } = state;
        return [
            endpointGroups,
            session && themes[session.uiTheme]
        ];
    }

    mapStateToProps(groups, theme) {
        if (!groups) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            const groupList = Object.values(groups);
            const endpointCount = sumBy(groupList, group => group.endpointCount);
            const cpuCount = sumBy(groupList, group => group.cpuCount);
            const cpuUsage = sumBy(groupList, group => group.cpuUsage);
            const memoryUsage = sumBy(groupList, group => group.memoryUsage);
            const lastUpdate = Math.min(...groupList.map(group => group.lastReportTime));

            const chartData = {
                labels: [
                    ...groupList.map(group => group.name),
                    ...makeArray(Math.max(3 - groupList.length, 0), () => '')
                ],
                datasets: [
                    {
                        categoryPercentage: .5,
                        backgroundColor: theme.color20,
                        data: groupList.map(group => group.endpointCount)
                    }
                ]
            };

            ko.assignToProps(this, {
                dataReady: true,
                groupCount: numeral(groupList.length).format(','),
                endpointCount: numeral(endpointCount).format(','),
                cpuUsage: `${numeral(cpuUsage).format('%')} (${stringifyAmount('core', cpuCount)})`,
                memoryUsage: numeral(memoryUsage).format('%'),
                lastUpdate: lastUpdate > 0 ? moment(lastUpdate).fromNow() : '',
                chart: { data: chartData }
            });
        }
    }
}

export default {
    viewModel: EndpointsSummaryViewModel,
    template: template
};
