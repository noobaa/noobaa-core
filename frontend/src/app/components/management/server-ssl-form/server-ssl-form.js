import template from './server-ssl-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { uploadSSLCertificate } from 'actions';
import { sslCertificateSuffix } from 'config';

class SSLFormViewModel {
    constructor({ onClose }) {
        this.expanded = ko.observable(false);

        let config = ko.pureComputed(
            () => systemInfo()
        );

        this.enabled = ko.observableWithDefault(
            () => !!config()
        );


        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );

        this.sslCertificateSuffix = sslCertificateSuffix;
        this.isUploadingSSLModalVisible = ko.observable(false);

        }

    uploadCertificate(certificate) {
        this.isUploadingSSLModalVisible(true);
        uploadSSLCertificate(certificate);
    }
}

export default {
    viewModel: SSLFormViewModel,
    template: template
}
