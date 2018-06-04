/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-resource-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta, getCloudTargetTooltip } from 'utils/cloud-utils';
import { validateName } from 'utils/validation-utils';
import { getFieldValue, isFieldTouched } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
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
    'S3_COMPATIBLE',
    'AZURE',
    'GOOGLE'
]);

class AddCloudResourceModalViewModel extends Observer {
    formName = this.constructor.name;
    existingNames = null;
    throttledResourceName = null;
    form = null;
    connectionOptions = ko.observableArray();
    nameRestrictionList = ko.observableArray();
    targetBucketsEmptyMessage = ko.observable();
    targetBucketsErrorMessage = ko.observable();
    isTargetBucketsInError = ko.observable();
    fetchingTargetBuckets = ko.observable();
    targetBucketsOptions = ko.observableArray();
    targetBucketPlaceholder = ko.observable();
    targetBucketLabel = ko.observable();
    connectionActions = deepFreeze([
        {
            label: 'Add new connection',
            onClick: this.onAddNewConnection.bind(this)
        }
    ]);

    constructor() {
        super();

        this.form = new FormViewModel({
            name: this.formName,
            fields: {
                connection: '',
                targetBucket: '',
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
                    'cloudResources',
                    'hostPools',
                    ['forms', this.formName],
                    'cloudTargets'
                )
            ),
            this.onState
        );
    }

    onState([
        accounts,
        session,
        cloudResources,
        hostPools,
        form,
        cloudTargets
    ]) {
        if (!accounts || !cloudResources || !hostPools || !form) return;

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

        // Load cloud targets if necessary.
        if (connection && connection !== cloudTargets.connection) {
            action$.next(fetchCloudTargets(connection));
        }

        // Suggest a name for the resource if the user didn't enter one himself.
        if (!isResourceNameTouched && targetBucket && resourceName !== targetBucket) {
            action$.next(updateForm(this.formName, { resourceName: targetBucket }, false));
        }

        const selectedConnection = externalConnections.find(con => con.name === connection);
        const subject = selectedConnection ? getCloudServiceMeta(selectedConnection.service).subject : '';
        const targetBucketPlaceholder = `Choose ${subject}`;
        const targetBucketLabel = `Target ${subject}`;
        const targetBucketsEmptyMessage = `No ${subject.toLowerCase()}s found`;
        const targetBucketsErrorMessage = `Cannot retrieve ${subject.toLowerCase()}s`;


        this.targetBucketLabel(targetBucketLabel);
        this.targetBucketsEmptyMessage(targetBucketsEmptyMessage);
        this.targetBucketsErrorMessage(targetBucketsErrorMessage);
        this.isTargetBucketsInError(cloudTargets.error);
        this.connectionOptions(connectionOptions);
        this.fetchingTargetBuckets(fetchingTargetBuckets);
        this.targetBucketsOptions(targetBucketsOptions);
        this.targetBucketPlaceholder(targetBucketPlaceholder);
        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
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
        const action = createCloudResource(resourceName, connection, targetBucket);

        action$.next(action);
        action$.next(closeModal());
    }

    onAddNewConnection() {
        action$.next(openAddCloudConnectionModal(allowedServices));
    }

    onCancel() {
        action$.next(closeModal());
    }

    dispose() {
        action$.next(dropCloudTargets());
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: AddCloudResourceModalViewModel,
    template: template
};

