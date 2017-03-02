import template from './file-uploads-modal.html';
import StateListener from 'state-listener';
import UploadRowViewModel from './upload-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import numeral from 'numeral';
import { clearCompletedObjectUploads } from 'dispatchers';
import style from 'style';

const columns = deepFreeze([
    'fileName',
    'bucketName',
    'size',
    'progress'
]);

class FileUploadsModalViewModel extends StateListener {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.columns = columns;
        this.countText = ko.observable();
        this.uploaded = ko.observable();
        this.failed = ko.observable();
        this.uploading = ko.observable();
        this.progress = ko.observable();
        this.progressText = ko.observable();
        this.rows = ko.observableArray();
        this.barValues = [
            {
                value: this.progress,
                color: style['color8']
            },
            {
                value: ko.pureComputed(() => 1 - this.progress()),
                color: style['color7']
            }
        ];
    }

    stateSelector(state) {
        return [ state.objectUploads ];
    }

    onState(objectUploads) {
        const { stats, objects } = objectUploads;
        const progressText = this._getCurrentUploadProgressText(stats);

        this.countText(stringifyAmount('file', stats.count));
        this.uploading(stats.uploading);
        this.failed(stats.failed);
        this.uploaded(stats.uploaded);
        this.progress(stats.batchLoaded / stats.batchSize);
        this.progressText(progressText);
        this.rows(
            Array.from(objects).reverse().map(
                (obj, i) => {
                    const row = this.rows()[i] || new UploadRowViewModel();
                    row.update(obj);
                    return row;
                }
            )
        );
    }

    onClearCompeleted() {
        clearCompletedObjectUploads();
    }

    _getCurrentUploadProgressText({ uploading, batchSize, batchLoaded }) {
        if (uploading === 0) {
            return '';
        }

        return `Uploading ${
            formatSize(batchLoaded)
        } of ${
            formatSize(batchSize)
        } (${
            numeral(batchLoaded/batchSize).format('%')
        })`;
    }
}

export default {
    viewModel: FileUploadsModalViewModel,
    template: template
};
