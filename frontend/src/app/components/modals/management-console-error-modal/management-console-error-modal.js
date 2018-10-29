/* Copyright (C) 2016 NooBaa */

import template from './management-console-error-modal.html';
import { support } from 'config';
import { deepFreeze } from 'utils/core-utils';
import { formatEmailUri, reloadBrowser } from 'utils/browser-utils';

const emailInfo = deepFreeze({
    text: support.email,
    href: formatEmailUri(support.email, support.managementConsoleSubject)
});

class ManagementConsoleErrorModalViewModel {
    constructor() {
        this.emailInfo = emailInfo;
    }

    onReload() {
        reloadBrowser('/');
    }
}

export default {
    viewModel: ManagementConsoleErrorModalViewModel,
    template: template
};
