/* Copyright (C) 2016 NooBaa */

import template from './attach-server-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { isFormValid } from 'utils/form-utils';
import { isIP } from 'utils/net-utils';
import { getMany } from 'rx-extensions';
import { state$, action$ } from 'state';
import { api } from 'services';
import {
    touchForm,
    attachServerToCluster,
    closeModal
} from 'action-creators';

const secretLength = 8;
const steps = deepFreeze([
    'Configure Server',
    'Edit Details'
]);

const fieldsByStep = {
    0: ['address', 'secret'],
    1: ['hostname', 'location']
};

class AttachServerModalViewModel extends Observer {
    formName = this.constructor.name;
    steps = steps;
    form = null;
    version = ko.observable();
    asyncValidationTriggers = ['address', 'secret'];
    fields = {
        step: 0,
        address: '',
        secret: '',
        hostname: '',
        location: 'DC1'
    }

    constructor() {
        super();

        this.observe(
            state$.pipe(getMany(
                ['system', 'version'],
                ['forms', this.formName]
            )),
            this.onState
        );
    }

    onState([version, form]) {
        const tooltip = version ? `System version: ${version}` : '';

        this.version(tooltip);
        this.isStepValid = form ? isFormValid(form) : false;
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

            case 'CONNECTION_TIMEOUT': {
                errors.address = 'Could not reach server, might be due to firewall blocking';
                break;
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            action$.next(touchForm(this.formName, fieldsByStep[step]));
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
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
