/* Copyright (C) 2016 NooBaa */

import template from './complete-ssl-certificate-installation-modal.html';
import ConnectableViewModel from 'components/connectable';
import { reloadBrowser } from 'utils/browser-utils';

class CompleteSSLCertificateInstallationModalViewModel extends ConnectableViewModel {
    onReloadPage() {
        reloadBrowser();
    }
}

export default {
    viewModel: CompleteSSLCertificateInstallationModalViewModel,
    template: template
};
