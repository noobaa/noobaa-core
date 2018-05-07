/* Copyright (C) 2016 NooBaa */

import template from './exit-confirmation-message.html';
import Observer from 'observer';
import { state$ } from 'state';
import { get } from 'utils/core-utils';
import { getMany } from 'rx-extensions';

class ExitConfirmationMessageViewModel extends Observer {
    constructor() {
        super();
        this.showMessage = false;

        this.observe(
            state$.pipe(
                getMany(
                    ['objectUploads', 'stats', 'uploading'],
                    ['topology', 'servers']
                )
            ),
            this.onState
        );
    }

    onState([uploadCount, servers = {}]) {
        const uploadingObjects = Boolean(uploadCount);
        const uploadingUpgradePackage = Object.values(servers)
            .some(server => get(server, ['upgrade', 'package', 'state'], 'NO_PACKAGE') === 'UPLOADING');

        this.showMessage = uploadingObjects || uploadingUpgradePackage;
    }

    onBeforeUnload(_, evt) {
        if (this.showMessage) {
            return evt.returnValue ='Changes you made may not be saved.';
        }
    }
}

export default {
    viewModel: ExitConfirmationMessageViewModel,
    template: template
};
