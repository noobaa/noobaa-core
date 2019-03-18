/* Copyright (C) 2016 NooBaa */

import template from './cloud-resource-summary.html';
import ConnectableViewModel from 'components/connectable';
import { getCloudResourceStateIcon } from 'utils/resource-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import ko from 'knockout';
import numeral from 'numeral';
import themes from 'themes';

function _getServiceDisplayName(resource) {
    return resource.type === 'S3_COMPATIBLE' ?
        'S3 Compatible' :
        getCloudServiceMeta(resource.type).displayName;
}

class CloudResourceSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    state = ko.observable();
    service = ko.observable();
    targetBucket = ko.observable();
    readCount = ko.observable();
    writeCount = ko.observable();
    readSize = {
        color: ko.observable(),
        value: ko.observable()
    };
    writeSize = {
        color: ko.observable(),
        value: ko.observable()
    };
    chartLegend = [
        {
            label: 'Reads',
            color: this.readSize.color,
            value: this.readSize.value
        },
        {
            label: 'Writes',
            color: this.writeSize.color,
            value: this.writeSize.value
        }
    ];
    chart = {
        options: {
            maintainAspectRatio: false,
            scales: {
                xAxes: [{
                    categoryPercentage: .7,
                    barPercentage: .8,
                    display: false
                }],
                yAxes: [{
                    gridLines: {
                        color: 'transparent',
                        drawTicks: false
                    },
                    ticks: {
                        callback: () => ''
                    }
                }]
            },
            tooltips: {
                enabled: false
            }
        },
        data: {
            labels: [],
            datasets: [
                {
                    backgroundColor: this.readSize.color,
                    hoverBackgroundColor: this.readSize.color,
                    data: [this.readSize.value]
                },
                {
                    backgroundColor: this.writeSize.color,
                    hoverBackgroundColor: this.writeSize.color,
                    data: [this.writeSize.value]
                }
            ]
        }
    }

    selectState(state, params) {
        const { cloudResources = {}, session } = state;
        return [
            cloudResources[params.resourceName],
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(resource, theme) {
        if (!resource) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { io } = resource;
            const { tooltip, ...icon } = getCloudResourceStateIcon(resource);

            ko.assignToProps(this, {
                dataReady: true,
                state: {
                    icon:icon,
                    text: tooltip
                },
                service: _getServiceDisplayName(resource),
                targetBucket: resource.target,
                readCount: numeral(io.readCount).format(','),
                writeCount: numeral(io.writeCount).format(','),
                readSize: {
                    color: theme.color20,
                    value: io.readSize
                },
                writeSize: {
                    color: theme.color28,
                    value: io.writeSize
                }
            });
        }
    }
}

export default {
    viewModel: CloudResourceSummaryViewModel,
    template: template
};
