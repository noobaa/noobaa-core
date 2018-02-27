/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-resource-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { inputThrottle } from 'config';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import {
    fetchCloudTargets,
    updateForm,
    dropCloudTargets,
    openAddCloudConnectionModal,
    closeModal,
    createNamespaceResource
} from 'action-creators';

const formName = 'createNSResourceForm';

class CreateNamespaceResourceModalViewModel extends Observer {
    fetchingTargets = ko.observable();
    targetOptions = ko.observableArray();
    existingNames = null;
    nameRestrictionList = ko.observableArray();
    myConnectionsHref = ko.observable();
    loadTargetsEmptyMessage = ko.observable();
    form = null;
    connectionOptions = ko.observableArray();
    conenctionActions = deepFreeze([
        {
            label: 'Add new connection',
            onClick: this.onAddNewConnection.bind(this)
        }
    ]);

    constructor() {
        super();

        this.form = new FormViewModel({
            name: formName,
            fields: {
                connection: '',
                target: '',
                resourceName: ''
            },
            onValidate: this.onValidate.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

        this.throttledResourceName = this.form.resourceName
            .throttle(inputThrottle);

        this.observe(
            state$.getMany(
                'accounts',
                'session',
                'namespaceResources',
                'hostPools',
                ['forms', formName],
                'cloudTargets',
                ['location', 'params', 'system'],
                ['session', 'user']
            ),
            this.onState
        );
    }

    onState([
        accounts,
        session,
        namespaceResources,
        hostPools,
        form,
        cloudTargets,
        system,
        user
    ]) {
        if (!accounts || !namespaceResources || !hostPools || !form) return;

        const { externalConnections } = accounts[session.user];
        const connectionOptions = externalConnections
            .map(conn => {
                const { icon, selectedIcon } = getCloudServiceMeta(conn.service);
                return {
                    label: conn.name,
                    value: conn.name,
                    remark: conn.identity,
                    icon: icon,
                    selectedIcon: selectedIcon
                };
            });

        const fetchingTargets = cloudTargets.fetching && !cloudTargets.list;
        const targetOptions = (cloudTargets.list || [])
            .map(target => ({
                value: target.name,
                disabled: Boolean(target.usedBy),
                tooltip: getCloudTargetTooltip(target)
            }));

        const { connection, resourceName, target } = form.fields;

        const existingNames = [ ...Object.keys(namespaceResources), ...Object.keys(hostPools) ];
        const nameRestrictionList = validateName(resourceName.value, existingNames)
            .map(result => {
                // Use nocss class to indeicate no css is needed, cannot use empty string
                // because of the use of logical or as condition fallback operator.
                const css =
                    (!connection.value && 'nocss') ||
                    (result.valid && 'success') ||
                    (resourceName.touched && 'error') ||
                    'nocss';

                return {
                    label: result.message,
                    css: css === 'nocss' ? '' : css
                };
            });

        // Load cloud targets of necessary.
        if (connection.value && connection.value !== cloudTargets.connection) {
            action$.onNext(fetchCloudTargets(connection.value));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!resourceName.touched && target.value && resourceName.value !== target.value) {
            action$.onNext(updateForm(formName, { resourceName: target.value }, false));
        }

        const myConnectionsHref = realizeUri(
            routes.account,
            { system, account: user, tab: 'connections' }
        );

        const selectedConnection = externalConnections.find(con => con.name === connection.value);
        const connectionSubject = selectedConnection ? getCloudServiceMeta(selectedConnection.service).subject : '';
        const loadTargetsEmptyMessage = cloudTargets.error ?
            { text: 'Loading failed', isError: true } :
            { text: `No ${connectionSubject.toLowerCase()}s found`, isError: false };

        this.loadTargetsEmptyMessage(loadTargetsEmptyMessage);
        this.connectionOptions(connectionOptions);
        this.fetchingTargets(fetchingTargets);
        this.targetOptions(targetOptions);
        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
        this.myConnectionsHref(myConnectionsHref);
    }

    onValidate(values) {
        const { connection, target, resourceName } = values;
        const errors = {};

        if (!connection) {
            errors.connection = 'Please select a connection';

        } else {
            if (!target) {
                errors.target = 'Please select a target bucket';
            }

            const hasNameErrors = validateName(resourceName, this.existingNames)
                .some(rule => !rule.valid);

            if (hasNameErrors) {
                errors.resourceName = '';
            }
        }

        return errors;
    }

    onSubmit(values) {
        const { resourceName, connection, target } = values;
        const action = createNamespaceResource(resourceName, connection, target);
        action$.onNext(action);
        action$.onNext(closeModal());
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    onAddNewConnection() {
        action$.onNext(openAddCloudConnectionModal());
    }

    dispose() {
        action$.onNext(dropCloudTargets());
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: CreateNamespaceResourceModalViewModel,
    template: template
};
