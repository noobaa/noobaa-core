import template from './server-ssl-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { sslCertificateSuffix } from 'config';
import { uploadSSLCertificate } from 'actions';
import { sslCertificateUploadStatus as uploadStatus } from 'model';

class SSLFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.expanded = ko.observable(false);
        this.sslCertificateSuffix = sslCertificateSuffix;

        this.sslConfigured = ko.observable('No');

        this.uploading = ko.pureComputed(
            () => uploadStatus() && uploadStatus().state === 'IN_PROGRESS'
        );

        this.uploadIcon = ko.pureComputed(
            () => this.uploading() ? 'in-progress' : ''
        );

        this.uploadText = ko.pureComputed(
            () => this.uploading && `Uploading cartificate ${
                numeral(uploadStatus().progress).format('0%')
            }`
        );
    }

    uploadCertificate(certificate) {
        uploadSSLCertificate(certificate);
    }
}

export default {
    viewModel: SSLFormViewModel,
    template: template
};
