/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-connection-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { addExternalConnection } from 'action-creators';
import services from './services';
import { state$, action$ } from 'state';
import { isURI } from 'validations';
import api from 'services/api';

const formName = 'addCloudConnection';
const nameRegExp = /^Connection (\d+)$/;
const defaultService = 'AWS';
const allServices = Object.keys(services);

function _mapServiceOption(service) {
    const { option, defaultEndpoint = 'No default endpoint' } = services[service];
    return {
        ...option,
        value: service,
        remark: defaultEndpoint
    };
}

function _generateConnectionName(existing) {
    const suffix = existing
        .map(({ name }) => {
            const match = name.match(nameRegExp);
            return match ? parseInt(match[1]) : 0;
        })
        .reduce(
            // For some reason sending Math.max to reduce reutrns NaN for any value.
            // Using an an arrow function to bypass the problem.
            (max, val) => Math.max(max, val),
            0
        );

    return `Connection ${suffix + 1}`;
}

class addCloudConnectionModalViewModel extends Observer {
    constructor({ onClose, allowedServices = allServices }){
        super();

        this.close = onClose;
        this.serviceOptions = allowedServices.map(_mapServiceOption);
        this.serviceMeta = null;
        this.identityLabel = ko.observable();
        this.identityPlaceholder = ko.observable();
        this.blackList = ko.observableArray();
        this.secretLabel = ko.observable();
        this.secretPlaceholder = ko.observable();
        this.existingConnections = null;
        this.form = null;
        this.isFormInitialized = ko.observable(false);

        this.observe(
            state$.getMany('accounts', ['session', 'user']),
            this.onAccounts
        );
    }

    onAccounts([ accounts, user ]) {
        if (this.isFormInitialized() || !accounts || !user) return;

        const { externalConnections } = accounts[user];
        const name = _generateConnectionName(externalConnections);

        this.existingConnections = externalConnections;
        this.form = new FormViewModel({
            name: formName,
            fields: {
                connectionName: name,
                service: defaultService,
                endpoint: services[defaultService].defaultEndpoint,
                identity: '',
                secret: ''
            },
            onForm: this.onForm.bind(this),
            onValidate: this.onValidate.bind(this),
            onValidateAsync: this.onValidateAsync.bind(this),
            asyncTriggers: ['service', 'endpoint', 'identity', 'secret'],
            onSubmit: this.onSubmit.bind(this)
        });
        this.isFormInitialized(true);
    }

    onValidate({ connectionName, service, endpoint, identity, secret }) {
        const { existingConnections, serviceMeta: meta } = this;
        const errors = {};

        if (!connectionName) {
            errors.connectionName = 'Please enter valid connection name';

        } else if (existingConnections
            .map(connection => connection.name)
            .includes(connectionName)
        ) {
            errors.connectionName = 'Name already in use';
        }

        if (!endpoint) {
            errors.endpoint = 'Please enter valid endpoint URI';

        } else if (!isURI(endpoint)) {
            errors.endpoint = 'Please enter valid endpoint URI';
        }

        if (!identity) {
            errors.identity = meta.identity.requiredMessage;

        } else if (existingConnections
            .some(connection =>
                connection.service === service &&
                connection.endpoint === endpoint &&
                connection.identity === identity)
        ) {
            errors.identity = 'A similar connection already exists';
        }

        if (!secret) {
            errors.secret = meta.secret.requiredMessage;
        }

        return errors;
    }

    async onValidateAsync({ service, endpoint, identity, secret }) {
        const result = await api.account.check_external_connection({
            endpoint_type: service,
            endpoint: endpoint,
            identity: identity,
            secret: secret
        });

        const errors = {};

        if (result === 'TIMEOUT') {
            errors.endpoint = 'Endpoint communication timed out';

        } else if (result === 'INVALID_ENDPOINT') {
            errors.endpoint = 'Please enter a valid endpoint';

        } else if (result === 'INVALID_CREDENTIALS') {
            errors.secret = errors.identity = 'Credentials does not match';

        } else if (result === 'NOT_SUPPORTED') {
            errors.identity = 'Account type is not supported';
        }
        else if (result === 'UNKNOWN_FAILURE') {
            errors.endpoint = 'Something went wrong';
        }

        return errors;
    }

    onForm() {
        const { service, endpoint } = this.form;
        const meta = this.serviceMeta = services[service()];

        this.identityLabel(meta.identity.label);
        this.identityPlaceholder(meta.identity.placeholder);
        this.secretLabel(meta.secret.label);
        this.secretPlaceholder(meta.secret.placeholder);

        if (!endpoint.wasTouched()) {
            endpoint.set(meta.defaultEndpoint);
        }
    }

    onSubmit({ connectionName, service, endpoint, identity, secret }) {
        action$.onNext(addExternalConnection(connectionName, service, endpoint, identity, secret));
        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: addCloudConnectionModalViewModel,
    template: template
};
