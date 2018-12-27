/* Copyright (C) 2016 NooBaa */

import template from './uploads-indicator.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { openFileUploadsModal } from 'action-creators';

class UploadsIndicatorViewModel extends ConnectableViewModel {
    uploadCount = ko.observable();
    lastUploadTime = ko.observable();
    uploadProgress = ko.observable();
    animatedCount = ko.observable();

    selectState(state) {
        return [
            state.objectUploads
        ];
    }

    mapStateToProps(objectUploads) {
        const { stats, lastUpload } = objectUploads;
        const { batchSize, batchLoaded } = stats;
        const shouldUpdateAnimatedCount = (!lastUpload.time || lastUpload.time > this.lastUploadTime());
        const progress = batchSize !== 0 ? batchLoaded / batchSize : 0;

        ko.assignToProps(this, {
            uploadCount: stats.uploading,
            lastUploadTime: lastUpload.time,
            uploadProgress: progress,
            animatedCount: shouldUpdateAnimatedCount ?
                lastUpload.objectCount :
                undefined
        });
    }

    onClick() {
        this.dispatch(openFileUploadsModal());
    }

    onUploadAnimationEnd() {
        this.animatedCount(0);
    }
}

export default {
    viewModel: UploadsIndicatorViewModel,
    template: template
};
