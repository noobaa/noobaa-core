/* Copyright (C) 2016 NooBaa */

import template from './server-ssl-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { sslCertificateSuffix } from 'config';
import { uploadSSLCertificate } from 'actions';
import { systemInfo, sslCertificateUploadStatus as uploadStatus } from 'model';

class SSLFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;
        this.sslCertificateSuffix = sslCertificateSuffix;

        this.sslStatus = ko.pureComputed(
            () => systemInfo() && systemInfo().has_ssl_cert ?
                'Customer SSL certificate installed' :
                'Using self-signed SSL certificate'
        );

        this.uploading = ko.pureComputed(
            () => uploadStatus() && uploadStatus().state === 'IN_PROGRESS'
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
