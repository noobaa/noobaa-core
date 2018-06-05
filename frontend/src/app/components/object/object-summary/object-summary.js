/* Copyright (C) 2016 NooBaa */

import template from './object-summary.html';
import ko from 'knockout';
import style from 'style';
import ConnectableViewModel from 'components/connectable';
import { toBytes } from 'utils/size-utils';
import { pick } from 'utils/core-utils';
import { splitObjectId, formatVersionId } from 'utils/object-utils';
import { timeShortFormat } from 'config';
import moment from 'moment';
import numeral from 'numeral';

class ObjectSummaryViewModel extends ConnectableViewModel {
    objectLoaded = ko.observable();
    bucketName = ko.observable();
    isVersioningOn = ko.observable();
    versionId = ko.observable();
    versionCount = ko.observable();
    contentType = ko.observable();
    creationTime = ko.observable();
    lastReadTime = ko.observable();
    readCount = ko.observable();
    size = [
        {
            label: 'Original Size',
            color: style['color7'],
            tooltip: 'The original size of the object as written prior to optimization or data resiliency',
            value: ko.observable()
        },
        {
            label: 'Actual Used Storage',
            color: style['color13'],
            tooltip: 'The actual raw usage of this object includes the data resiliency replications or fragments after compression',
            value: ko.observable()
        }
    ];
    chart = {
        visible: ko.observable(),
        values: this.size.map(item => ({
            label: item.label,
            parts: [
                pick(item, ['color', 'value'])
            ]
        }))
    }

    selectState(state, params) {
        const { buckets = {}, objects = {} } = state;
        const { bucket: bucketName } = splitObjectId(params.objectId);
        const query = objects.queries[objects.views[params.fetchOwner]];
        const versionCount = (query && query.result) ? query.result.items.length : NaN;

        return [
            buckets[bucketName],
            objects.items[params.objectId],
            versionCount
        ];
    }

    mapStateToProps(bucket, object, versionCount) {
        if (!bucket || !object) {
            ko.assignToProps(this, { objectLoaded: false });

        } else {
            ko.assignToProps(this, {
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
                size: [
                    { value: toBytes(object.size.original) },
                    { value: toBytes(object.size.onDisk || 0) }
                ],
                chart: {
                    visible: object.size.onDisk !== null
                },
                objectLoaded: true
            });
        }
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
