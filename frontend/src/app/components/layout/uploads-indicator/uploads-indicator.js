import template from './uploads-indicator.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import ko from 'knockout';
import style from 'style';
import { openFileUploadsModal } from 'dispatchers';
// import numeral from 'numeral';
// import moment from 'moment';

class UploadsIndicatorViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.uploadCount = ko.observable(0);
        this.uploadProgress = ko.observable(0);
        this.animatedCount = ko.observable(0);
        this.uploadBarValues = [
            {
                value: this.uploadProgress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(() => 1 - this.uploadProgress()),
                color: style['color6']
            }
        ];

    }

    onState({ objectUploads: uploads }, { objectUploads: prevUploads }) {
        if (uploads === prevUploads) {
            return;
        }

        const { stats, lastUpload } = uploads;
        this.uploadCount(stats.uploading);
        this.uploadProgress(stats.batchLoaded / stats.batchSize);

        if(!prevUploads || lastUpload.time > prevUploads.lastUpload.time) {
            this.animatedCount(lastUpload.objectCount);
        }
    }

    onUploads() {
        openFileUploadsModal();
    }

    onUploadAnimationEnd() {
        this.animatedCount(0);
    }
}

export default {
    viewModel: UploadsIndicatorViewModel,
    template: template
};
