/* Copyright (C) 2016 NooBaa */

import template from './uploads-indicator.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import style from 'style';
import { openFileUploadsModal } from 'action-creators';

class UploadsIndicatorViewModel extends Observer {
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

        this.lastUploadTime = ko.observable();

        this.observe(state$.get('objectUploads'), this.onUploads);
    }

    onUploads(objectUploads) {
        const { stats, lastUpload } = objectUploads;
        this.uploadCount(stats.uploading);
        this.uploadProgress(stats.batchLoaded / stats.batchSize);

        if (!lastUpload.time || lastUpload.time > this.lastUploadTime()) {
            this.animatedCount(lastUpload.objectCount);
        }

        // Save the last upload for the next state update.
        this.lastUploadTime(lastUpload.time);
    }

    onClick() {
        action$.onNext(openFileUploadsModal());
    }

    onUploadAnimationEnd() {
        this.animatedCount(0);
    }
}

export default {
    viewModel: UploadsIndicatorViewModel,
    template: template
};
