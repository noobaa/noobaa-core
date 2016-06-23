import template from './upload-ssl-modal.html';
import ko from 'knockout';
import numeral from 'numeral';
import { uploadStatus } from 'model';

class UploadSSlModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;

        let step = ko.pureComputed(
            () => uploadStatus() && uploadStatus().step
        );

        this.progress = ko.pureComputed(
            () => uploadStatus() ? uploadStatus().progress : 0
        );

        this.uploadFailed = ko.pureComputed(
            () => {
                this.errorMessage = uploadStatus().text;
                return !!uploadStatus() && uploadStatus().state === 'FAILED';
            }
        );


        this.success = ko.pureComputed(
            () => {
                return !!uploadStatus() && uploadStatus().state === 'SUCCESS';
            }
        );

        this.stepClass = ko.pureComputed(
            () => (step() || '').toLowerCase()
        );

        this.progressText = ko.pureComputed(
            () => step() === 'UPLOAD' ?
                `Uploading ssl certificates ${numeral(this.progress()).format('0%')}` :
                'Verifing certificate...'
        );
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: UploadSSlModalViewModel,
    template: template
}
