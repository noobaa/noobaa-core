import template from './object-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import style from 'style';
import { sizeToBytes } from 'utils/size-utils';

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
            () => obj() && obj().stats.last_read
        ).extend({
            formatTime: true
        });

        this.readCount = ko.pureComputed(
            () => obj() ? obj().stats.reads : 0
        );

        this.barsValues = [
            {
                label: 'Original size',
                value: ko.pureComputed(
                    () => sizeToBytes(obj().size)
                ),
                color: style['color7']
            },
            {
                label: 'Size on Disk (with replicas)',
                value: ko.pureComputed(
                    () => sizeToBytes(obj().capacity_size)
                ),
                color: style['color13']
            }
        ];
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
