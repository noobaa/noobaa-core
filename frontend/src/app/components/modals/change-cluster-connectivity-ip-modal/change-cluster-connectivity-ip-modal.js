/* Copyright (C) 2017 NooBaa */

import template from './change-cluster-connectivity-ip-modal.html';
import ConnectableViewModel from 'components/connectable';
import { isIP } from 'utils/net-utils';
import ko from 'knockout';
import { updateServerAddress, closeModal } from 'action-creators';
import { api } from 'services';

class ChangeClusterConnectivityIpModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    fields = ko.observable();
    asyncTriggers = [ 'newAddress' ];
    secret = '';
    hostname = '';
    oldAddress = ko.observable();

    selectState(state, params) {
        const { topology, forms } = state;
        return [
            topology && state.topology.servers[params.secret],
            forms[this.formName]
        ];
    }

    mapStateToProps(server, form) {
        if (server) {
            const { secret, hostname, addresses } = server;

            ko.assignToProps(this, {
                secret,
                hostname,
                oldAddress: addresses.length > 0 ? addresses[0].ip : '',
                fields: !form ? { newAddress: '' } : undefined
            });
        }
    }

    onValidate(values) {
        const errors = {};
        const { newAddress } = values;

        if (!isIP(newAddress)) {
            errors.newAddress = 'Please enter a valid IP';
        }

        return errors;
    }

    async onValidateAsync(values) {
        const errors = {};
        const { newAddress } = values;
        const { result } = await api.cluster_server.verify_new_ip({
            address: newAddress,
            secret: this.secret
        });

        switch (result) {
            case 'SECRET_MISMATCH': {
                errors.newAddress = 'Secret does not match server';
                break;
            }
            case 'UNREACHABLE': {
                errors.newAddress = 'Server is unreachable';
                break;
            }
        }

        return errors;
    }

    onSubmit(values) {
        this.dispatch(
            closeModal(),
            updateServerAddress(
                this.secret,
                values.newAddress,
                this.hostname
            )
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: ChangeClusterConnectivityIpModalViewModel,
    template: template
};
