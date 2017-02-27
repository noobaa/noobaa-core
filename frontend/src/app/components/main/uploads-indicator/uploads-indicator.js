import template from './uploads-indicator.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import style from 'style';
import { openFileUploadsModal } from 'dispatchers';
// import numeral from 'numeral';
// import moment from 'moment';

class UploadsIndicatorViewModel extends StateListener {
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

    stateEventsFilter(state) {
        return [ state.objectUploads ];
    }

    onState({ objectUploads }, prevState) {
        const { stats, lastUpload } = objectUploads;
        this.uploadCount(stats.uploading);
        this.uploadProgress(stats.batchLoaded / stats.batchSize);

        const prevUploads = prevState && prevState.objectUploads;
        if(!prevUploads || lastUpload.time > prevUploads.lastUpload.time) {
            this.animatedCount(lastUpload.objectCount);
        }
    }

    onClick() {
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
