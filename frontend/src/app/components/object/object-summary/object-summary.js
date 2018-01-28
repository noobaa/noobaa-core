/* Copyright (C) 2016 NooBaa */

import template from './object-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import { state$ } from 'state';
import { toBytes } from 'utils/size-utils';
import { pick } from 'utils/core-utils';
import { getObjectId } from 'utils/object-utils';
import { timeShortFormat } from 'config';
import moment from 'moment';
import numeral from 'numeral';

class ObjectSummaryViewModel extends Observer {
    objectLoaded = ko.observable();
    objectKey = '';
    bucketName = ko.observable();
    contentType = ko.observable();
    creationTime = ko.observable();
    lastReadTime = ko.observable();
    readCount = ko.observable();
    originalSize = ko.observable();
    sizeOnDisk = ko.observable();
    size = [
        {
            label: 'Original size',
            color: style['color7'],
            tooltip: 'The original size of the file as written prior to optimization or data resiliency',
            value: this.originalSize
        },
        {
            label: 'Actual Used Storage',
            color: style['color13'],
            tooltip: 'The actual raw usage of this file includes the data resiliency replications or fragments after compression',
            value: this.sizeOnDisk
        }
    ];
    chart = {
        visible: ko.observable(),
        values: this.size
            .map(item => ({
                label: item.label,
                parts: [
                    pick(item, ['color', 'value'])
                ]
            }))
    }

    constructor(params) {
        super();

        const { bucketName, objKey } = ko.deepUnwrap(params);
        const objId = getObjectId(bucketName, objKey);

        this.observe(
            state$.get('objects', 'items', objId),
            this.onState
        );
    }

    onState(object) {
        if (!object) {
            this.objectLoaded(false);
            return;
        }

        const creationTime = moment(object.createTime).format(timeShortFormat);
        const lastReadTime = object.lastReadTime ?
            moment(object.lastRead).format(timeShortFormat) :
            'File not read';
        const readCount = numeral(object.readCount).format(',');
        const sizeOnDisk = toBytes(object.size.onDisk || 0);
        const isChartVisible = object.size.onDisk !== null;

        this.bucketName(object.bucket);
        this.contentType(object.contentType);
        this.creationTime(creationTime);
        this.lastReadTime(lastReadTime);
        this.readCount(readCount);
        this.originalSize(toBytes(object.size.original));
        this.sizeOnDisk(sizeOnDisk);
        this.chart.visible(isChartVisible);
        this.objectLoaded(true);
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
