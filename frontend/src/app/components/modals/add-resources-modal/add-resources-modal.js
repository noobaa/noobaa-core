/* Copyright (C) 2016 NooBaa */

import template from './add-resources-modal.html';
import ConnectableViewModel from 'components/connectable';
import {
    closeModal,
    openInstallNodesModal,
    openAddCloudResourceModal
} from 'action-creators';

class AddResourcesModalViewModel extends ConnectableViewModel {
    onInstallNodes() {
        this.dispatch(
            closeModal(),
            openInstallNodesModal()
        );
    }

    onAddCloudResource() {
        this.dispatch(
            closeModal(),
            openAddCloudResourceModal()
        );
    }
}

export default {
    viewModel: AddResourcesModalViewModel,
    template: template
};
