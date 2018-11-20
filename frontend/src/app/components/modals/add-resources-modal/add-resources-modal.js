/* Copyright (C) 2016 NooBaa */

import template from './add-resources-modal.html';
import ConnectableViewModel from 'components/connectable';
import {
    replaceWithInstallNodesModal,
    replaceWithAddCloudResourceModal
} from 'action-creators';

class AddResourcesModalViewModel extends ConnectableViewModel {
    onInstallNodes() {
        this.dispatch(replaceWithInstallNodesModal());
    }

    onAddCloudResource() {
        this.dispatch(replaceWithAddCloudResourceModal());
    }
}

export default {
    viewModel: AddResourcesModalViewModel,
    template: template
};
