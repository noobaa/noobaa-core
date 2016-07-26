import template from './object-details-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';

const timeFormat = 'DD MMM YYYY hh:mm:ss';

class ObjectInfoFormViewModel extends Disposable {
    constructor({ obj }) {
        super();

        this.name = ko.pureComputed(
            () => obj() && obj().key
        );

        this.bucketName = ko.pureComputed(
            () => obj() && obj().bucket
        );

        this.creationTime = ko.pureComputed(
            () => obj() && (
                obj().create_time ? moment(obj().create_time).format(timeFormat) : 'N/A'
            )
        );

        this.contentType = ko.pureComputed(
            () => obj() && obj().content_type
        );

        this.lastRead = ko.pureComputed(
            () => obj() && (
                obj().stats.last_read ? moment(obj().stats.last_read).format(timeFormat) : 'N/A'
            )
        );

        this.s3SignedUrl = ko.pureComputed(
            () => obj() && obj().s3_signed_url
        );

        this.isPreviewModalVisible = ko.observable(false);
    }

    showPreviewModal() {
        this.isPreviewModalVisible(true);
    }

    hidePreviewModal() {
        this.isPreviewModalVisible(false);
    }

    downloadObject() {

    }
}

export default {
    viewModel: ObjectInfoFormViewModel,
    template: template
};
