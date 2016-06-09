import template from './object-details-form.html';
import ko from 'knockout';
import moment from 'moment';

class ObjectInfoFormViewModel {
    constructor({ obj }) {


        this.name = ko.pureComputed(
            () => obj() && obj().key
        );

        this.bucketName = ko.pureComputed(
            () => obj() && obj().bucket
        );

        this.creationTime = ko.pureComputed(
            () => obj() && moment(obj().creation_time).format('DD MMM YYYY hh:mm:ss')
        );

        this.contentType = ko.pureComputed(
            () => obj() && obj().content_type
        );

        this.cloudSynced = ko.pureComputed(
            () => obj() && obj().cloud_synced ? 'yes' : 'no'
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
