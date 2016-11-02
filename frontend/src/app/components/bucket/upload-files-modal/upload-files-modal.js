import template from './upload-files-modal.html';
import Disposable from 'disposable';
import UploadRowViewModel from './upload-row';
import { uploads } from 'model';
import { deepFreeze } from 'utils';

const columns = deepFreeze([
    'fileName',
    'progress'
]);

class UploadFilesModalViewModel extends Disposable {
    constructor({ onClose }){
        super();

        this.columns = columns;
        this.onClose = onClose;
        this.uploads = uploads;
    }

    createUploadRow(file) {
        return new UploadRowViewModel(file);
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: UploadFilesModalViewModel,
    template: template
};
