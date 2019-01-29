/* Copyright (C) 2016 NooBaa */

import template from './disable-host-endpoint-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, toggleHostServices } from 'action-creators';
import ko from 'knockout';

class DisableHostEndpointWarningModalViewModel extends ConnectableViewModel {
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
        this.dispatch(closeModal());
        this.dispatch(toggleHostServices(this.host, { endpoint: false }));
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DisableHostEndpointWarningModalViewModel,
    template: template
};
