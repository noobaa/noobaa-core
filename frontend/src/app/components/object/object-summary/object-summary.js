/* Copyright (C) 2016 NooBaa */

import template from './object-summary.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import { toBytes } from 'utils/size-utils';
import { sumBy } from 'utils/core-utils';

class ObjectSummaryViewModel extends BaseViewModel {
    constructor({ obj }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!obj()
        );

        this.bucketName = ko.pureComputed(
            () => obj() && obj().bucket
        );

        this.contentType = ko.pureComputed(
            () => obj() && obj().content_type
        );

        this.creationTime = ko.pureComputed(
            () => obj() && obj().create_time
        ).extend({
            formatTime: true
        });

        this.lastRead = ko.pureComputed(
            () => (obj() && obj().stats.last_read) || undefined
        ).extend({
            formatTime: { notAvailableText: 'File not read' }
        });

        this.readCount = ko.pureComputed(
            () => obj() ? obj().stats.reads : 0
        );

        this.barChartData  = [
            {
                label: 'Original size',
                color: style['color7'],
                tooltip: 'The original size of the file as written prior to optimization or data resiliency',
                parts: [
                    {
                        value: ko.pureComputed(() => toBytes(obj().size)),
                        color: style['color7']
                    }
                ]
            },
            {
                label: 'Actual Used Storage',
                color: style['color13'],
                tooltip: 'The actual raw usage of this file includes the data resiliency replications or fragments after compression',
                parts: [
                    {
                        value: ko.pureComputed(() => toBytes(obj().capacity_size)),
                        color: style['color13']
                    }
                ]
            }
        ];

        this.barsValues = this.barChartData.map(({ label, color, tooltip, parts }) => ({
            label,
            color,
            tooltip,
            value: sumBy(parts, ({ value }) => value())
        }));
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
