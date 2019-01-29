/* Copyright (C) 2016 NooBaa */

import template from './attach-server-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { isFormValid } from 'utils/form-utils';
import { isIP } from 'utils/net-utils';
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

class AttachServerModalViewModel extends ConnectableViewModel {
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

    selectState(state) {
        const { system, forms } = state;
        return [
            system && system.version,
            forms[this.formName]
        ];
    }

    mapStateToProps(version, form) {
        ko.assignToProps(this, {
            version: version ? `System version: ${version}` : '',
            isStepValid: form ? isFormValid(form) : false
        });
    }

    onValidate(values) {
        const { step, address, secret} = values;
        const errors = {};

        if (step === 0) {
            if (!isIP(address)) {
                errors.address = 'Please enter a valid IP address';
            }

            if (!secret) {
                errors.secret = 'Please enter the server secret key';
            } else if (secret.length !== secretLength) {
                errors.secret = `Server secret key should be ${secretLength} characters long`;
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
                errors.secret = `Secret key does not match the server secret key at ${address}`;
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

            case 'CONNECTION_TIMEOUT_ORIGIN': {
                errors.address = 'Firewall might be blocking master connectivity to new server';
                break;
            }

            case 'CONNECTION_TIMEOUT_NEW': {
                errors.address = 'Firewall might be blocking new server connectivity to master';
                break;
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onSubmit(values) {
        const { secret, address } = values;
        const location = values.location ? values.location : undefined;
        const hostname = values.hostname ? values.hostname : undefined;

        this.dispatch(
            closeModal(),
            attachServerToCluster(secret, address, hostname, location)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
