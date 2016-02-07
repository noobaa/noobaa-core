import template from './upload-files-modal.html';
import UploadRowViewModel from './upload-row';
import { paginationPageSize } from 'config';
import { makeArray } from 'utils'
import { recentUploads } from 'model';
import { uploadFiles } from 'actions';



class UploadFilesModalViewModel {
    constructor({ bucketName, onClose }){
        this.bucketName = bucketName;
        this.onClose = onClose;
        
        this.files = makeArray(
            paginationPageSize,
            i => new UploadRowViewModel(() => recentUploads()[i])
        );
    }

    upload(files) {
        uploadFiles(this.bucketName(), files);
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: UploadFilesModalViewModel,
    template: template
};