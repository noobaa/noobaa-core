/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-bucket-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { validateName } from 'utils/validation-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getMany } from 'rx-extensions';
import { state$, action$ } from 'state';
import { closeModal, createNamespaceBucket } from 'action-creators';
import { inputThrottle } from 'config';

const formName = 'createNamespaceBucket';
const steps = deepFreeze([
    'Choose Name',
    'Set Placement'
]);

const readPolicyTableColumns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'Namespace Resource Name'
    },
    {
        name: 'target',
        label: 'Target Name'
    }
]);

class CreateNamespaceBucketModalViewModel extends Observer {
    steps = steps;
    nameRestrictionList = ko.observableArray();
    readPolicyTableColumns = readPolicyTableColumns;
    readPolicyRows = ko.observableArray();
    isWritePolicyDisabled = ko.observable();
    writePolicyOptions = ko.observableArray();
    resourceServiceMapping = {};
    form = null;
    throttledBucketName = null;
    readPolicyRowParams = {
        onToggle: this.onToggleReadPolicyResource.bind(this)
    };

    constructor() {
        super();

        this.form = new FormViewModel({
            name: formName,
            fields: {
                step: 0,
                bucketName: '',
                readPolicy: [],
                writePolicy: undefined
            },
            groups: {
                0: [ 'bucketName' ],
                1: [ 'readPolicy', 'writePolicy' ]
            },
            onValidate: this.onValidate.bind(this),
            onWarn: values => this.onWarn(values, this.resourceServiceMapping),
            onSubmit: this.onSubmit.bind(this)
        });

        this.throttledBucketName = this.form.bucketName
            .throttle(inputThrottle);

        this.observe(
            state$.pipe(
                getMany(
                    ['forms', formName],
                    'buckets',
                    'namespaceBuckets',
                    'namespaceResources'
                )
            ),
            this.onState
        );
    }

    onState([ form, buckets, namespaceBuckets, resources ]) {
        if (!buckets || !form) return;

        const { bucketName, readPolicy } = form.fields;
        const existingNames = [
            ...Object.keys(buckets),
            ...Object.keys(namespaceBuckets)
        ];

        const nameRestrictionList = validateName(bucketName.value, existingNames)
            .map(result => {
                // Use nocss class to indeicate no css is needed, cannot use empty string
                // because of the use of logical or as condition fallback operator.
                const css =
                    (!bucketName.touched && 'nocss') ||
                    (result.valid && 'success') ||
                    'error';

                return {
                    label: result.message,
                    css: css === 'nocss' ? '' : css
                };
            });

        const resourceList = Object.values(resources);
        const readPolicyRows = resourceList
            .map((resource, i) => {
                const row = this.readPolicyRows.get(i) || new ResourceRowViewModel(this.readPolicyRowParams);
                row.onResource(resource, readPolicy.value);
                return row;
            });
        const writePolicyOptions = resourceList
            .filter(resource => readPolicy.value.includes(resource.name))
            .map(resource => {
                const { name: value, service } = resource;
                const { icon, selectedIcon } = getCloudServiceMeta(service);
                return { value, icon, selectedIcon };
            });

        const resourceServiceMapping = mapValues(
            resources,
            resource => resource.service
        );

        this.resources = resources;
        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
        this.readPolicyRows(readPolicyRows);
        this.isWritePolicyDisabled(readPolicy.value.length === 0);
        this.writePolicyOptions(writePolicyOptions);
        this.resourceServiceMapping = resourceServiceMapping;
    }

    onToggleReadPolicyResource(resource, select) {
        const { readPolicy } = this.form;
        if (!select) {
            const filtered = readPolicy().filter(name => name !== resource);
            readPolicy(filtered);

        } else if (!readPolicy().includes(resource)) {
            readPolicy([ ...readPolicy(), resource ]);
        }
    }

    onValidate(values) {
        const { step, bucketName, readPolicy, writePolicy } = values;
        const errors = {};

        if (step === 0) {
            const hasNameErrors = validateName(bucketName, this.existingNames)
                .some(rule => !rule.valid);

            if (hasNameErrors) {
                errors.bucketName = '';
            }

        } else if (step === 1) {
            if (readPolicy.length === 0) {
                errors.readPolicy = 'Please select at least one namespace resources';

            } else if (!writePolicy) {
                errors.writePolicy = 'Please select a namespace resource';
            }
        }

        return errors;
    }

    onWarn (values, resourceServiceMapping) {
        const { step, readPolicy } = values;
        const warnings = {};

        if (step === 1 && readPolicy.length > 1) {
            const firstService = resourceServiceMapping[readPolicy[0]];
            const mixedServices = readPolicy.some(res => resourceServiceMapping[res] !== firstService);

            if (mixedServices) {
                warnings.readPolicy = 'A mixture of different resource services will require to read and re-write the data without optimization';
            }
        }

        return warnings;
    }

    onBeforeStep(step) {
        if (!this.form.isValid()) {
            this.form.touch(step);
            return false;
        }

        return true;
    }

    onSubmit(values) {
        const { bucketName, readPolicy, writePolicy } = values;
        action$.next(createNamespaceBucket(bucketName, readPolicy, writePolicy));
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
    viewModel: CreateNamespaceBucketModalViewModel,
    template: template
};

