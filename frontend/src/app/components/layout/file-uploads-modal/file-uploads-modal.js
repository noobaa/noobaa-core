import template from './file-uploads-modal.html';
import Disposable from 'disposable';
import UploadRowViewModel from './upload-row';
import ko from 'knockout';
import { recentUploads } from 'model';
import { deepFreeze } from 'utils';
import { clearCompletedUploads } from 'actions';
import style from 'style';

const columns = deepFreeze([
    'fileName',
    'bucketName',
    'progress'
]);

class RecentFileUploadingModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.requests = recentUploads;
        this.columns = columns;
        this.onClose = onClose;

        this.uploadState = ko.pureComputed(
            () => {
                let progressAcc = 0;
                let state = recentUploads().reduce(
                    (state, upload) => {
                        switch (upload.state){
                            case 'UPLOADING':
                                ++state.uploadingCount;
                                progressAcc += upload.progress;
                                break;
                            case 'UPLOADED':
                                ++state.uploadedCount;
                                progressAcc += 1;
                                break;
                            case 'FAILED':
                                ++state.failedCount;
                                progressAcc += 1;
                                break;
                        }
                        return state;
                    },
                    {
                        uploadingCount: 0,
                        uploadedCount: 0,
                        failedCount: 0
                    }
                );
                state['progress'] = progressAcc / recentUploads().length;
                state['totalCount'] = recentUploads().length;
                return state;
            }
        );

        this.progressText = ko.pureComputed(
            () => `(${
                Math.floor(this.uploadState()['progress'] * 100)
            }%)`
        );

        // let uploadsProgress = ko.pureComputed(
        //     () => this.uploadState().progress
        // );
        this.emptyColor = style['color7'];
        this.barValues = [
            {
                value: ko.pureComputed(
                    () => this.uploadState().progress
                ),
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => 1 - this.uploadState().progress
                ),
                color: this.emptyColor
            }
        ];
    }

    createUploadRow(file) {
        return new UploadRowViewModel(file);
    }

    clearCompleted() {
        clearCompletedUploads();
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: RecentFileUploadingModalViewModel,
    template: template
};
