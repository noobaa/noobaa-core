/* Copyright (C) 2016 NooBaa */

import template from './edit-server-details-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, updateServerDetails } from 'action-creators';
import { isHostname } from 'validations';
import ko from 'knockout';

class EditServerDetailsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    serverSecret = '';
    serverHostname = '';
    formFields = ko.observable();

    selectState(state, params) {
        const { servers } = state.topology || {};
        return [
            servers && servers[params.serverSecret],
            state.forms[this.formName]
        ];
    }

    mapStateToProps(server, form) {
        if (server) {
            const { secret, hostname, locationTag } = server;

            ko.assignToProps(this, {
                serverSecret: secret,
                serverHostname: hostname,
                formFields: !form ?
                    { hostname, locationTag } :
                    undefined
            });
        }
    }

    onValidate(values) {
        const { hostname } = values;
        const errors = {};

        if (!hostname || !isHostname(hostname)) {
            errors.hostname = 'Please enter a valid hostname';
        }

        return errors;
    }

    onSubmit(values) {
        this.dispatch(
            updateServerDetails(
                this.serverSecret,
                this.serverHostname,
                values.hostname,
                values.locationTag
            ),
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditServerDetailsModalViewModel,
    template: template
};
