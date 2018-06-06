/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-resource-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, throttle } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { getFormValues, isFieldTouched } from 'utils/form-utils';
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

const allowedServices = deepFreeze([
    'AWS',
    'S3_COMPATIBLE',
    'AZURE'
]);

class CreateNamespaceResourceModalViewModel extends Observer {
    formName = this.constructor.name;
    fields = {
        connection: '',
        target: '',
        resourceName: ''
    };
    fetchingTargets = ko.observable();
    targetOptions = ko.observableArray();
    existingNames = [];
    nameRestrictionList = ko.observableArray();
    targetBucketsEmptyMessage = ko.observable();
    targetBucketsErrorMessage = ko.observable();
    isTargetBucketsInError = ko.observable();
    targetBucketPlaceholder = ko.observable();
    targetBucketLabel = ko.observable();
    connectionOptions = ko.observableArray();
    connectionActions = deepFreeze([
        {
            label: 'Add new connection',
            onClick: this.onAddNewConnection.bind(this)
        }
    ]);
    onResourceNameThrottled = throttle(
        this.onResourceName.bind(this),
        inputThrottle,
        this
    );

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    'session',
                    'namespaceResources',
                    'hostPools',
                    'cloudTargets',
                    ['forms', this.formName],
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
        cloudTargets,
        form
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

        const { connection, resourceName, target } = getFormValues(form);
        const isResourceNameTouched = isFieldTouched(form, 'resourceName');

        const existingNames = [ ...Object.keys(namespaceResources), ...Object.keys(hostPools) ];
        const nameRestrictionList = validateName(resourceName, existingNames)
            .map(result => {
                // Use nocss class to indeicate no css is needed, cannot use empty string
                // because of the use of logical or as condition fallback operator.
                const css =
                    (!connection && 'nocss') ||
                    (result.valid && 'success') ||
                    (isResourceNameTouched && 'error') ||
                    'nocss';

                return {
                    label: result.message,
                    css: css === 'nocss' ? '' : css
                };
            });

        // Load cloud targets of necessary.
        if (connection && connection !== cloudTargets.connection) {
            action$.next(fetchCloudTargets(connection));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!isResourceNameTouched && target) {
            const suggestedName = target.toLowerCase();
            if (resourceName !== suggestedName) {
                action$.next(updateForm(this.formName, { resourceName: suggestedName }, false));
            }
        }

        const selectedConnection = externalConnections.find(con => con.name === connection);
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

    onResourceName(resourceName) {
        action$.updateForm(this.formName, { resourceName });
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
        super.dispose();
    }
}

export default {
    viewModel: CreateNamespaceResourceModalViewModel,
    template: template
};
