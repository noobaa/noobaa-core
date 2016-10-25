import template from './recent-file-uploading-modal.html';
import Disposable from 'disposable';
import UploadRowViewModel from './upload-row';
import ko from 'knockout';
import { recentUploads } from 'model';
import { deepFreeze } from 'utils';
import style from 'style';

const columns = deepFreeze([
    'fileName',
    'bucketName',
    'progress'
]);

class RecentFileUploadingModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.columns = columns;
        this.onClose = onClose;

        this.requests = recentUploads;

        this.total = ko.pureComputed(
            () => this.requests().length
        );

        this.uploadState = ko.pureComputed(
            () => this.requests().reduce(
                (state, request) => {
                    switch (request.state){
                        case 'UPLOADING':
                            ++state.uploading;
                            break;
                        case 'UPLOADED':
                            ++state.uploaded;
                            ++state.completed;
                            break;
                        case 'FAILED':
                            ++state.failed;
                            ++state.completed;
                            break;
                    }
                    return state;
                },
                {
                    uploading: 0,
                    uploaded: 0,
                    failed: 0,
                    completed: 0
                }
            )
        );

        this.completed = ko.pureComputed(
            () => Math.floor(100 * this.uploadState().completed / this.total())
        );

        this.showProgress = ko.pureComputed(
            () => this.total() > 0
        );

        this.progress = ko.pureComputed(
            () => {
                let totalProgress = this.requests().reduce(
                    (total, request) => {
                        let fixedProgress = request.state === 'FAILED' ? 1 : request.progress;
                        return total + fixedProgress;
                    },
                    0
                );
                return totalProgress / this.total();
            }
        );
        this.emptyColor = style['color7'];
        this.barValues = [
            {
                value: this.progress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => 1 - this.progress()
                ),
                color: this.emptyColor
            }
        ];
    }

    createUploadRow(file) {
        return new UploadRowViewModel(file);
    }

    clearCompleted() {
        this.requests.remove(
            request => request.state === 'UPLOADED' || request.state === 'FAILED'
        );
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: RecentFileUploadingModalViewModel,
    template: template
};
