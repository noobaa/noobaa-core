/* Copyright (C) 2017 NooBaa */

import template from './change-cluster-connectivity-ip-modal.html';
import Observer from 'observer';
import { isIP } from 'utils/net-utils';
import { get } from 'rx-extensions';
import ko from 'knockout';
import { updateServerAddress, closeModal } from 'action-creators';
import { action$, state$ } from 'state';
import { api } from 'services';

class ChangeClusterConnectivityIpModalViewModel extends Observer {
    formName = this.constructor.name;
    fields = { newAddress: '' };
    asyncTriggers = [ 'newAddress' ];
    secret = '';
    hostname = '';
    oldAddress = ko.observable();
    isServerLoaded = ko.observable();

    constructor({ secret }) {
        super();

        this.secret = ko.unwrap(secret);

        this.observe(
            state$.pipe(get('topology', 'servers', this.secret)),
            this.onState
        );
    }

    onState(server) {
        if (!server) {
            this.isServerLoaded(false);
            return;
        }
        const address = server.addresses[0].ip;

        this.hostname = server.hostname;
        this.oldAddress(address);
        this.isServerLoaded(true);
    }

    onValidate({ newAddress }) {
        const errors = {};

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
        action$.next(
            updateServerAddress(
                this.secret,
                values.newAddress,
                this.hostname
            )
        );
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: ChangeClusterConnectivityIpModalViewModel,
    template: template
};
