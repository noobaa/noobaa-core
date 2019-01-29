/* Copyright (C) 2016 NooBaa */

import template from './object-summary.html';
import ko from 'knockout';
import ConnectableViewModel from 'components/connectable';
import { toBytes } from 'utils/size-utils';
import { splitObjectId, formatVersionId } from 'utils/object-utils';
import { timeShortFormat } from 'config';
import moment from 'moment';
import numeral from 'numeral';
import themes from 'themes';

class ObjectSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = ko.observable();
    isVersioningOn = ko.observable();
    versionId = ko.observable();
    versionCount = ko.observable();
    contentType = ko.observable();
    creationTime = ko.observable();
    lastReadTime = ko.observable();
    readCount = ko.observable();
    originalSize = {
        color: ko.observable(),
        value: ko.observable()
    };
    actualSize = {
        color: ko.observable(),
        value: ko.observable()
    };

    legend = [
        {
            label: 'Original Size',
            color: this.originalSize.color,
            tooltip: 'The original size of the object as written prior to optimization or data resiliency',
            value: this.originalSize.value
        },
        {
            label: 'Actual Used Storage',
            color: this.actualSize.color,
            tooltip: 'The actual raw usage of this object includes the data resiliency replications or fragments after compression',
            value: this.actualSize.value
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
                    backgroundColor: this.originalSize.color,
                    hoverBackgroundColor: this.originalSize.color,
                    data: [this.originalSize.value]
                },
                {
                    backgroundColor: this.actualSize.color,
                    hoverBackgroundColor: this.actualSize.color,
                    data: [this.actualSize.value]
                }
            ]
        }
    }


    selectState(state, params) {
        const { buckets = {}, objects = {}, session } = state;
        const { bucket: bucketName } = splitObjectId(params.objectId);
        const query = objects.queries[objects.views[params.fetchOwner]];
        const versionCount = (query && query.result) ? query.result.items.length : NaN;

        return [
            buckets[bucketName],
            objects.items[params.objectId],
            versionCount,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(bucket, object, versionCount, theme) {
        if (!bucket || !object) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { original, onDisk } = object.size;

            ko.assignToProps(this, {
                dataReady: true,
                isVersioningOn: bucket.versioning.mode !== 'DISABLED',
                versionId: formatVersionId(object.versionId),
                versionCount: Number.isNaN(versionCount) ? 'calculating...' : numeral(versionCount).format(','),
                bucketName: bucket.name,
                contentType: object.contentType,
                creationTime: moment(object.createTime).format(timeShortFormat),
                lastReadTime: object.lastReadTime ?
                    moment(object.lastRead).format(timeShortFormat) :
                    'File not read',
                readCount: numeral(object.readCount).format(','),
                originalSize: {
                    value: toBytes(original),
                    color: theme.color6
                },
                actualSize: {
                    value: toBytes(onDisk || 0),
                    color: theme.color28
                }
            });
        }
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
