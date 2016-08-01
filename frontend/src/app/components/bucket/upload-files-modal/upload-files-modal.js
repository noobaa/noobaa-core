import template from './upload-files-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import UploadRowViewModel from './upload-row';
import { recentUploads } from 'model';
import { uploadFiles } from 'actions';
import { deepFreeze } from 'utils';

const columns = deepFreeze([
    'fileName',
    'progress'
]);

class UploadFilesModalViewModel extends Disposable {
    constructor({ bucketName, onClose }){
        super();

        this.columns = columns;
        this.bucketName = bucketName;
        this.onClose = onClose;

        this.requests = ko.pureComputed(
            () => recentUploads().filter(
                ({ targetBucket }) => targetBucket === ko.unwrap(bucketName)
            )
        );
    }

    createUploadRow(file) {
        return new UploadRowViewModel(file);
    }

    upload(files) {
        uploadFiles(ko.unwrap(this.bucketName), files);
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: UploadFilesModalViewModel,
    template: template
};
