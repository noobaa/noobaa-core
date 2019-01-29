/* Copyright (C) 2016 NooBaa */

import template from './disable-host-storage-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import {
    closeModal,
    toggleHostServices,
    openEditHostStorageDrivesModal
} from 'action-creators';

class DisableHostStorageWarningModalViewModel extends ConnectableViewModel {
    host = '';
    isLastService = ko.observable();

    selectState(_, params) {
        return [
            params.host,
            params.isLastService
        ];
    }

    mapStateToProps(host, isLastService) {
        ko.assignToProps(this, {
            host,
            isLastService
        });
    }

    onApprove() {
        this.dispatch(
            closeModal(),
            toggleHostServices(this.host, { storage: false })
        );
    }

    onBack() {
        this.dispatch(
            closeModal(),
            openEditHostStorageDrivesModal(this.host, this.isLastService)
        );
    }
}

export default {
    viewModel: DisableHostStorageWarningModalViewModel,
    template: template
};
