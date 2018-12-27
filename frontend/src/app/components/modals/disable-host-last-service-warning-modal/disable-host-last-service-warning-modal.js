/* Copyright (C) 2016 NooBaa */

import template from './disable-host-last-service-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import { toggleHostServices, closeModal } from 'action-creators';
import ko from 'knockout';
import { getHostServiceDisplayName } from 'utils/host-utils';

class DisableHostLastServiceWarningModalViewModel extends ConnectableViewModel {
    host = '';
    service = '';
    serviceName = ko.observable();

    selectState(_, params) {
        return [
            params.host,
            params.service
        ];
    }

    mapStateToProps(host, service) {
        ko.assignToProps(this, {
            host,
            service,
            serviceName: getHostServiceDisplayName(service)
        });
    }

    onApprove() {
        this.dispatch(
            closeModal(),
            toggleHostServices(this.host, { [this.service]: false })
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DisableHostLastServiceWarningModalViewModel,
    template: template
};
