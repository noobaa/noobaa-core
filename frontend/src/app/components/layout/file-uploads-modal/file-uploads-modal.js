import template from './file-uploads-modal.html';
import BaseViewModel from 'base-view-model';
import UploadRowViewModel from './upload-row';
import ko from 'knockout';
import { uploads } from 'model';
import { deepFreeze, stringifyAmount, formatSize } from 'utils/all';
import { clearCompletedUploads } from 'actions';
import style from 'style';
import numeral from 'numeral';

const columns = deepFreeze([
    'fileName',
    'bucketName',
    'size',
    'progress'
]);

class FileUploadsModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.uploads = uploads;
        this.columns = columns;
        this.onClose = onClose;

        this.countText = ko.pureComputed(
            () => stringifyAmount('file', uploads.stats().count)
        );

        let uploadStats = uploads.stats;

        this.uploaded = ko.pureComputed(
            () => uploadStats().uploaded
        );

        this.failed = ko.pureComputed(
            () => uploadStats().failed
        );

        this.uploading = ko.pureComputed(
            () => uploadStats().uploading
        );

        let progress = ko.pureComputed(
            () => {
                let { size, progress } = uploadStats().batch;
                return progress / size;
            }
        );

        this.progressText = ko.pureComputed(
            () => {
                if (uploadStats().uploading === 0) {
                    return '';
                }

                return `Uploading ${
                    formatSize(uploadStats().batch.progress)
                } of ${
                    formatSize(uploadStats().batch.size)
                } (${
                    numeral(progress()).format('%')
                })`;
            }
        );

        this.barValues = [
            {
                value: progress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(
                    () => 1 - progress()
                ),
                color: style['color7']
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
    viewModel: FileUploadsModalViewModel,
    template: template
};
