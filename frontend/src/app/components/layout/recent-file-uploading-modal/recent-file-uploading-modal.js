import template from './recent-file-uploading-modal.html';
import Disposable from 'disposable';
import UploadRowViewModel from './upload-row';
import ko from 'knockout';
import { recentUploads } from 'model';
import { deepFreeze } from 'utils';
import { uploadFiles } from 'actions';

const columns = deepFreeze([
    'fileName',
    'bucketName',
    'size',
    'progress'
]);

class RecentFileUploadingModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.columns = columns;
        this.onClose = onClose;

        //this.requests = recentUploads;
        this.requests = ko.pureComputed(
            () => recentUploads()
        );
    }

    createUploadRow(file) {
        return new UploadRowViewModel(file);
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: RecentFileUploadingModalViewModel,
    template: template
};
