/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-resource-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, throttle } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { getFormValues, isFieldTouched } from 'utils/form-utils';
import { inputThrottle } from 'config';
import {
    fetchCloudTargets,
    updateForm,
    dropCloudTargets,
    openAddCloudConnectionModal,
    closeModal,
    createNamespaceResource
} from 'action-creators';
import { createNamespaceResource as learnMoreHref } from 'knowledge-base-articles';

const allowedServices = deepFreeze([
    'AWS',
    'S3_V2_COMPATIBLE',
    'S3_V4_COMPATIBLE',
    'AZURE',
    'NET_STORAGE'
]);

class CreateNamespaceResourceModalViewModel extends ConnectableViewModel {
    learnMoreHref = learnMoreHref;
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

    selectState(state) {
        return [
            state.accounts,
            state.session,
            state.namespaceResources,
            state.hostPools,
            state.cloudTargets,
            state.forms && state.forms[this.formName]
        ];
    }

    mapStateToProps(
        accounts,
        session,
        namespaceResources,
        hostPools,
        cloudTargets,
        form
    ) {
        if (!accounts || !namespaceResources || !hostPools || !form) {
            return;
        }

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

        const selectedConnection = externalConnections.find(con => con.name === connection);
        const subject = selectedConnection ? getCloudServiceMeta(selectedConnection.service).subject : '';

        ko.assignToProps(this, {
            targetBucketPlaceholder: `Choose ${subject}`,
            targetBucketLabel: `Target ${subject}`,
            targetBucketsEmptyMessage: `No ${subject.toLowerCase()}s found`,
            targetBucketsErrorMessage: `Cannot retrieve ${subject.toLowerCase()}s`,
            isTargetBucketsInError: cloudTargets.error,
            connectionOptions,
            fetchingTargets,
            targetOptions,
            existingNames,
            nameRestrictionList
        });


        // Load cloud targets of necessary.
        if (connection && connection !== cloudTargets.connection) {
            this.dispatch(fetchCloudTargets(connection));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!isResourceNameTouched && target) {
            const suggestedName = target.toLowerCase();
            if (resourceName !== suggestedName) {
                this.dispatch(updateForm(this.formName, { resourceName: suggestedName }, false));
            }
        }

    }

    onResourceName(resourceName) {
        this.dispatch(updateForm(this.formName, { resourceName }));
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
        this.dispatch(
            closeModal(),
            createNamespaceResource(resourceName, connection, target)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onAddNewConnection() {
        this.dispatch(openAddCloudConnectionModal(allowedServices));
    }

    dispose() {
        this.dispatch(dropCloudTargets());
        super.dispose();
    }
}

export default {
    viewModel: CreateNamespaceResourceModalViewModel,
    template: template
};
