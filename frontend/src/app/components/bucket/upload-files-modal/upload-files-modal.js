import template from './upload-files-modal.html';
import ko from 'knockout';
import UploadRowViewModel from './upload-row';
import { paginationPageSize } from 'config';
import { makeArray } from 'utils'
import { recentUploads } from 'model';
import { uploadFiles } from 'actions';

class UploadFilesModalViewModel {
    constructor({ bucketName, onClose }){
        this.bucketName = bucketName;
        this.onClose = onClose;
        
        let recentUploadsToBucket = ko.pureComputed(
            () => recentUploads().filter(
                ({ targetBucket }) => targetBucket === ko.unwrap(bucketName)
            )
        );

        this.files = makeArray(
            paginationPageSize,
            i => new UploadRowViewModel(() => recentUploadsToBucket()[i])
        );
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