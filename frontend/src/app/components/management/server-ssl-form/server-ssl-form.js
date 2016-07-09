import template from './server-ssl-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { sslCertificateSuffix } from 'config';
import { deepFreeze } from 'utils';
import { uploadSSLCertificate } from 'actions';
import { sslCertificateUploadStatus } from 'model';

const uploadStateMapping = deepFreeze({
    IN_PROGRESS: ({ progress }) => ({
        icon: '/fe/assets/icons.svg#in-progress',
        message: `Uploading cartificate ${numeral(progress).format('0%')}`
    }),

    SUCCESS: () => ({
        icon: '/fe/assets/icons.svg#notif-success',
        message: 'Certificate uploaded and verified'
    }),

    ABORTED: () => ({
        icon: '/fe/assets/icons.svg#notif-warning',
        message: 'Upload aborted'
    }),

    FAILED: ({ error }) => ({
        icon: '/fe/assets/icons.svg#notif-warning',
        message: `Upload failed: ${error}`
    })
});

class SSLFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.expanded = ko.observable(false);
        this.sslCertificateSuffix = sslCertificateSuffix;

        this.sslConfigured = ko.observable('No');

        let uploadMetadata = ko.pureComputed(
            () => {
                if (!sslCertificateUploadStatus()) {
                    return { message: '', icon: '' };
                }

                let mapper = uploadStateMapping[sslCertificateUploadStatus().state];
                return mapper(sslCertificateUploadStatus());
            }
        );

        this.uploadIcon = ko.pureComputed(
            () => uploadMetadata().icon
        );

        this.uploadText = ko.pureComputed(
            () => uploadMetadata().message
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
