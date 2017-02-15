import template from './file-uploads-modal.html';
import StateAwareViewModel from 'components/state-aware-view-model';
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

function formatProgress(total, uploaded) {
    return `Uploading ${
            formatSize(uploaded)
        } of ${
            formatSize(total)
        } (${
            numeral(uploaded/total).format('%')
        })`;
}

class FileUploadsModalViewModel extends StateAwareViewModel {
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

    onState({ objectUploads: uploads }, { uploads: prevUploads }) {
        if (uploads === prevUploads) {
            return;
        }

        const { stats, requests } = uploads;
        const  progressText = stats.uploading > 0 ?
            formatProgress(stats.batchSize, stats.batchLoaded) :
            '';

        this.countText(stringifyAmount('file', stats.count));
        this.uploading(stats.uploading);
        this.failed(stats.failed);
        this.uploaded(stats.uploaded);
        this.progress(stats.batchLoaded / stats.batchSize);
        this.progressText(progressText);
        this.rows(
            requests.map(
                (req, i) => {
                    const row = this.rows()[i] || new UploadRowViewModel();
                    row.update(req);
                    return row;
                }
            )
        );
    }

    onClearCompeleted() {
        clearCompletedObjectUploads();
    }
}

export default {
    viewModel: FileUploadsModalViewModel,
    template: template
};
