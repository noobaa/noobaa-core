/* Copyright (C) 2016 NooBaa */

import template from './ssl-certificate-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { sslCertificateSuffix } from 'config';
import { hasOwn } from 'utils/core-utils';
import { realizeUri, readFileAsArrayBuffer } from 'utils/browser-utils';
import * as routes from 'routes';
import { bufferStore } from 'services';
import { requestLocation, uploadSSLCertificate } from 'action-creators';

const sectionName = 'server-ssl';

class SSLCertificateFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    sslCertificateSuffix = sslCertificateSuffix;
    toggleUri = '';
    isExpanded = ko.observable();
    isCertInstalled = ko.observable();
    isCertUploading = ko.observable();
    uploadText = ko.observable();

    selectState(state) {
        const { system, forms, location } = state;
        return [
            system && system.sslCert,
            forms[this.formName],
            location
        ];
    }

    mapStateToProps(sslCert, form, location) {
        if (!sslCert) {
            return;
        }

        const { system, section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(routes.management, { system, tab: 'settings', section: toggleSection });

        ko.assignToProps(this, {
            toggleUri,
            isExpanded: section === sectionName,
            isCertInstalled: sslCert.installed,
            isCertUploading: hasOwn(sslCert, 'uploadProgress'),
            uploadText: `Uploading cartificate ${numeral(sslCert.uploadProgress).format('%')}`
        });
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onDropCertPkg(_, evt) {
        const [pkg] = evt.dataTransfer.files;
        return this._uploadCertPkg(pkg);
    }

    onSelectCrtPkg(_, evt) {
        const [pkg] = evt.target.files;
        return this._uploadCertPkg(pkg);
    }

    async _uploadCertPkg(pkg) {
        const buffer = await readFileAsArrayBuffer(pkg);
        const bufferKey = bufferStore.store(buffer);

        this.dispatch(uploadSSLCertificate(bufferKey));
    }
}

export default {
    viewModel: SSLCertificateFormViewModel,
    template: template
};
