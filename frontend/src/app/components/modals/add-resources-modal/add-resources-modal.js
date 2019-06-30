/* Copyright (C) 2016 NooBaa */

import template from './add-resources-modal.html';
import ConnectableViewModel from 'components/connectable';
import {
    closeModal,
    openDeployK8sPoolModal,
    openAddCloudResourceModal
} from 'action-creators';

class AddResourcesModalViewModel extends ConnectableViewModel {
    onDeployK8SNodes() {
        this.dispatch(
            closeModal(),
            openDeployK8sPoolModal()
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
