/* Copyright (C) 2016 NooBaa */

import template from './exit-confirmation-message.html';
import ConnectableViewModel from 'components/connectable';
import { get } from 'utils/core-utils';
import ko from 'knockout';

class ExitConfirmationMessageViewModel extends ConnectableViewModel {
    showMessage = false;

    selectState(state) {
        const { objectUploads, topology } = state;

        return [
            Boolean(objectUploads && objectUploads.stats.uploading),
            topology && topology.servers
        ];
    }

    mapStateToProps(uploadingObjects, servers = {}) {
        const uploadingUpgradePackage = Object.values(servers)
            .some(server => {
                const pkgState = get(server, ['upgrade', 'package', 'state'], 'NO_PACKAGE');
                return pkgState === 'UPLOADING';
            });

        ko.assignToProps(this, {
            showMessage: uploadingObjects || uploadingUpgradePackage
        });
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
