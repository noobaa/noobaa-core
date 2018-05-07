/* Copyright (C) 2016 NooBaa */

import template from './attach-server-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { isIP } from 'utils/net-utils';
import { get } from 'rx-extensions';
import { state$, action$ } from 'state';
import { attachServerToCluster, closeModal } from 'action-creators';
import { api } from 'services';

const formName = 'attachNewServer';
const secretLength = 8;
const steps = deepFreeze([
    'Configure Server',
    'Edit Details'
]);

class AttachServerModalViewModel extends Observer {
    steps = steps;
    form = null;
    version = ko.observable();

    constructor() {
        super();

        this.form = new FormViewModel({
            name: formName,
            fields: {
                step: 0,
                address: '',
                secret: '',
                hostname: '',
                location: 'DC1'
            },
            groups: {
                0: ['address', 'secret'],
                1: ['hostname', 'location']
            },
            asyncTriggers: ['address', 'secret'],
            onValidate: this.onValidate.bind(this),
            onValidateAsync: this.onValidateAsync.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

        this.observe(
            state$.pipe(get('system', 'version')),
            this.onState
        );
    }

    onState(version) {
        const tooltip = version ? `System version: ${version}` : '';
        this.version(tooltip);

    }

    onValidate(values) {
        const { step, address, secret} = values;
        const errors = {};

        if (step === 0) {
            if (!isIP(address)) {
                errors.address = 'Please enter a valid IP address';
            }

            if (!secret) {
                errors.secret = 'Please enter the server unique id';
            } else if (secret.length !== secretLength) {
                errors.secret = `Unique id is exactly ${secretLength} characters long`;
            }
        }

        return errors;
    }

    async onValidateAsync(values) {
        const errors = {};
        const { address, secret } = values;
        const { result } = await api.cluster_server.verify_candidate_join_conditions({
            address,
            secret
        });

        switch (result) {
            case 'SECRET_MISMATCH': {
                errors.secret = `This unique id does not match the server at ${address}`;
                break;
            }
            case 'ADDING_SELF': {
                errors.address = 'Already a member of this cluster';
                break;
            }
            case 'UNREACHABLE': {
                errors.address = 'Address unreachable';
                break;
            }
            case 'VERSION_MISMATCH': {
                errors.address = 'Server is not up to date';
                break;
            }
            case 'ALREADY_A_MEMBER': {
                errors.address = 'Already a member of a cluster';
                break;
            }
            case 'HAS_OBJECTS': {
                errors.address = 'Server hold uploaded files';
                break;
            }
            case 'NO_NTP_SET': {
                errors.address = 'Please configure NTP on the target server before attaching';
                break;
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.form.isValid()) {
            this.form.touch(step);
            return false;
        }

        return true;
    }

    onSubmit(values) {
        const { secret, address } = values;
        const location = values.location ? values.location : undefined;
        const hostname = values.hostname ? values.hostname : undefined;

        action$.next(attachServerToCluster(secret, address, hostname, location));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
