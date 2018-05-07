/* Copyright (C) 2016 NooBaa */

import template from './upgrade-system-failed-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { closeModal } from 'action-creators';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

class UpgradeSystemFailedModalViewModel extends Observer {
    constructor() {
        super();

        this.supportEmail = formatEmailUri(support.email, support.upgradeFailedSubject);

    }

    onGoBack() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: UpgradeSystemFailedModalViewModel,
    template: template
};
