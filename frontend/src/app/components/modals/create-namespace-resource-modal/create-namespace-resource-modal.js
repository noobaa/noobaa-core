/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-resource-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { getMany } from 'rx-extensions';
import { inputThrottle } from 'config';
import {
    fetchCloudTargets,
    updateForm,
    dropCloudTargets,
    openAddCloudConnectionModal,
    closeModal,
    createNamespaceResource
} from 'action-creators';

const formName = 'createNSResourceForm';

const allowedServices = deepFreeze([
    'AWS',
    'S3_COMPATIBLE',
    'AZURE'
]);

class CreateNamespaceResourceModalViewModel extends Observer {
    fetchingTargets = ko.observable();
    targetOptions = ko.observableArray();
    existingNames = null;
    nameRestrictionList = ko.observableArray();
    targetBucketsEmptyMessage = ko.observable();
    targetBucketsErrorMessage = ko.observable();
    isTargetBucketsInError = ko.observable();
    targetBucketPlaceholder = ko.observable();
    targetBucketLabel = ko.observable();
    form = null;
    connectionOptions = ko.observableArray();
    connectionActions = deepFreeze([
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
            onValidate: values => this.onValidate(values, this.existingNames),
            onSubmit: this.onSubmit.bind(this)
        });

        this.throttledResourceName = this.form.resourceName
            .throttle(inputThrottle);

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    'session',
                    'namespaceResources',
                    'hostPools',
                    ['forms', formName],
                    'cloudTargets'
                )
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
        cloudTargets
    ]) {
        if (!accounts || !namespaceResources || !hostPools || !form) return;

        const { externalConnections } = accounts[session.user];
        const connectionOptions = externalConnections
            .filter(connection => allowedServices.includes(connection.service))
            .map(connection => {
                const { icon, selectedIcon } = getCloudServiceMeta(connection.service);
                return {
                    label: connection.name,
                    value: connection.name,
                    remark: connection.identity,
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
            action$.next(fetchCloudTargets(connection.value));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!resourceName.touched && target.value && resourceName.value !== target.value) {
            action$.next(updateForm(formName, { resourceName: target.value }, false));
        }

        const selectedConnection = externalConnections.find(con => con.name === connection.value);
        const subject = selectedConnection ? getCloudServiceMeta(selectedConnection.service).subject : '';
        const targetBucketPlaceholder = `Choose ${subject}`;
        const targetBucketLabel = `Target ${subject}`;
        const targetBucketsEmptyMessage = `No ${subject.toLowerCase()}s found`;
        const targetBucketsErrorMessage = `Cannot retrieve ${subject.toLowerCase()}s`;

        this.targetBucketPlaceholder(targetBucketPlaceholder);
        this.targetBucketLabel(targetBucketLabel);
        this.targetBucketsEmptyMessage(targetBucketsEmptyMessage);
        this.targetBucketsErrorMessage(targetBucketsErrorMessage);
        this.isTargetBucketsInError(cloudTargets.error);
        this.connectionOptions(connectionOptions);
        this.fetchingTargets(fetchingTargets);
        this.targetOptions(targetOptions);
        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
    }

    onValidate(values, existingNames) {
        const { connection, target, resourceName } = values;
        const errors = {};

        if (!connection) {
            errors.connection = 'Please select a connection';

        } else {
            if (!target) {
                errors.target = 'Please select a target bucket';
            }

            const hasNameErrors = validateName(resourceName, existingNames)
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
        action$.next(action);
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    onAddNewConnection() {
        action$.next(openAddCloudConnectionModal(allowedServices));
    }

    dispose() {
        action$.next(dropCloudTargets());
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: CreateNamespaceResourceModalViewModel,
    template: template
};
