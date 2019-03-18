/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-resource-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, throttle } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { getFieldValue, isFieldTouched } from 'utils/form-utils';
import { inputThrottle } from 'config';
import {
    openAddCloudConnectionModal,
    createCloudResource,
    fetchCloudTargets,
    dropCloudTargets,
    closeModal,
    updateForm
} from 'action-creators';

const allowedServices = deepFreeze([
    'AWS',
    'S3_V2_COMPATIBLE',
    'S3_V4_COMPATIBLE',
    'AZURE',
    'GOOGLE',
    'FLASHBLADE'
]);

class AddCloudResourceModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    existingNames = null;
    connectionOptions = ko.observableArray();
    nameRestrictionList = ko.observableArray();
    targetBucketsEmptyMessage = ko.observable();
    targetBucketsErrorMessage = ko.observable();
    isTargetBucketsInError = ko.observable();
    fetchingTargetBuckets = ko.observable();
    targetBucketsOptions = ko.observableArray();
    targetBucketPlaceholder = ko.observable();
    targetBucketLabel = ko.observable();
    connectionActions = deepFreeze([{
        label: 'Add new connection',
        onClick: this.onAddNewConnection.bind(this)
    }]);
    fields = {
        connection: '',
        targetBucket: '',
        resourceName: ''
    };
    onResourceNameThrottled = throttle(
        this.onResourceName,
        inputThrottle,
        this
    );

    selectState(state) {
        return [
            state.accounts,
            state.session,
            state.cloudResources,
            state.hostPools,
            state.forms[this.formName],
            state.cloudTargets
        ];
    }

    mapStateToProps(
        accounts,
        session,
        cloudResources,
        hostPools,
        form,
        cloudTargets
    ) {
        if (!accounts || !cloudResources || !hostPools || !form) {
            return;
        }

        const { externalConnections } = accounts[session.user];
        const connectionOptions = externalConnections
            .filter(conn => allowedServices.includes(conn.service))
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

        const fetchingTargetBuckets = cloudTargets.fetching && !cloudTargets.list;
        const targetBucketsOptions = (cloudTargets.list || [])
            .map(target => {
                const { usedBy, name: value } = target;
                if (usedBy) {
                    return {
                        value,
                        disabled: Boolean(usedBy),
                        tooltip: getCloudTargetTooltip(target)
                    };
                } else {
                    return { value };
                }
            });

        const connection = getFieldValue(form, 'connection');
        const resourceName = getFieldValue(form, 'resourceName');
        const isResourceNameTouched = isFieldTouched(form, 'resourceName');
        const targetBucket = getFieldValue(form, 'targetBucket').toLowerCase();
        const existingNames = [ ...Object.keys(cloudResources), ...Object.keys(hostPools) ];
        const nameRestrictionList = validateName(resourceName, existingNames)
            .map(result => {
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
            targetBucketLabel: `Target ${subject}`,
            targetBucketsEmptyMessage: `No ${subject.toLowerCase()}s found`,
            targetBucketsErrorMessage: `Cannot retrieve ${subject.toLowerCase()}s`,
            targetBucketPlaceholder: `Choose: ${subject}`,
            isTargetBucketsInError: cloudTargets.error,
            connectionOptions,
            fetchingTargetBuckets,
            targetBucketsOptions,
            existingNames,
            nameRestrictionList
        });


        // Load cloud targets if necessary.
        if (connection && connection !== cloudTargets.connection) {
            this.dispatch(fetchCloudTargets(connection));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!isResourceNameTouched && targetBucket && resourceName !== targetBucket) {
            this.dispatch(updateForm(this.formName, { resourceName: targetBucket }, false));
        }
    }

    onResourceName(resourceName) {
        this.dispatch(updateForm(this.formName, { resourceName }));
    }

    onValidate(values, existingNames) {
        const { connection, targetBucket, resourceName } = values;
        const errors = {};

        if (!connection) {
            errors.connection = 'Please select a connection from the list';

        } else {
            if (!targetBucket) {
                errors.targetBucket = 'Please select a target bucket';
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
        const { resourceName, connection, targetBucket } = values;

        this.dispatch(
            closeModal(),
            createCloudResource(resourceName, connection, targetBucket)
        );
    }

    onAddNewConnection() {
        this.dispatch(openAddCloudConnectionModal(allowedServices));
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    dispose() {
        this.dispatch(dropCloudTargets());
        super.dispose();
    }
}

export default {
    viewModel: AddCloudResourceModalViewModel,
    template: template
};

