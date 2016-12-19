import template from './object-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

class ObjectSummaryViewModel extends Disposable {
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
                    () => obj().capacity_size
                ),
                color: style['color13']
            },
            {
                label: 'Size on Disk (with replicas)',
                value: ko.pureComputed(
                    () => obj().size
                ),
                color: style['color7']
            }
        ];
    }
}

export default {
    viewModel: ObjectSummaryViewModel,
    template: template
};
