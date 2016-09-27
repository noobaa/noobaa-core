import template from './object-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import style from 'style';

const timeFormat = 'DD MMM YYYY hh:mm:ss';

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
            () => obj() && (
                obj().create_time ? moment(obj().create_time).format(timeFormat) : 'N/A'
            )
        );

        this.lastRead = ko.pureComputed(
            () => obj() && (
                obj().stats.last_read ? moment(obj().stats.last_read).format(timeFormat) : 'N/A'
            )
        );

        this.readCount = ko.pureComputed(
            () => obj() ? obj().stats.reads : 0
        );

        this.barsValues = [
            {
                label: 'Physical size',
                value: ko.pureComputed(
                    () => obj().capacity_size
                ),
                color: style['color13']
            },
            {
                label: 'Size',
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
