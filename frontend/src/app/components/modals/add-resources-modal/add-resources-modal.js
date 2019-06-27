/* Copyright (C) 2016 NooBaa */

import template from './add-resources-modal.html';
import ConnectableViewModel from 'components/connectable';
import {
    closeModal,
    openDeployK8SPoolModal,
    openInstallNodesModal,
    openAddCloudResourceModal
} from 'action-creators';

class AddResourcesModalViewModel extends ConnectableViewModel {
    onDeployK8SNodes() {
        this.dispatch(
            closeModal(),
            openDeployK8SPoolModal()
        );
    }

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
