/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-bucket-modal.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { deepFreeze, mapValues, throttle } from 'utils/core-utils';
import { validateName } from 'utils/validation-utils';
import { getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import { getFieldValue, isFieldTouched, isFormValid } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import { state$, action$ } from 'state';
import { inputThrottle } from 'config';
import {
    updateForm,
    touchForm,
    closeModal,
    createNamespaceBucket
} from 'action-creators';
import { createNamespaceBucket as learnMoreHref } from 'knowledge-base-articles';

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

const fieldsByStep = deepFreeze({
    0: [ 'bucketName' ],
    1: [ 'readPolicy', 'writePolicy' ]
});

class CreateNamespaceBucketModalViewModel extends Observer {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    steps = steps;
    nameRestrictionList = ko.observableArray();
    readPolicyTableColumns = readPolicyTableColumns;
    readPolicyRows = ko.observableArray();
    isWritePolicyDisabled = ko.observable();
    writePolicyOptions = ko.observableArray();
    resourceServiceMapping = {};
    readPolicy = [];
    readPolicyRowParams = {
        onToggle: this.onToggleReadPolicyResource.bind(this)
    };
    fields = {
        step: 0,
        bucketName: '',
        readPolicy: [],
        writePolicy: undefined
    };
    onBucketNameThrottled = throttle(
        this.onBucketName,
        inputThrottle,
        this
    );

    constructor() {
        super();

        this.observe(
            state$.pipe(getMany(
                'buckets',
                'namespaceBuckets',
                'namespaceResources',
                ['forms', this.formName]
            )),
            this.onState
        );
    }

    onState([ buckets, namespaceBuckets, resources, form ]) {
        if (!buckets || !namespaceBuckets || !resources || !form) {
            return;
        }

        const bucketName = getFieldValue(form, 'bucketName');
        const readPolicy = getFieldValue(form, 'readPolicy');
        const existingNames = [
            ...Object.keys(buckets),
            ...Object.keys(namespaceBuckets)
        ];

        const nameRestrictionList = validateName(bucketName, existingNames)
            .map(result => {
                // Use nocss class to indeicate no css is needed, cannot use empty string
                // because of the use of logical or as condition fallback operator.
                const css =
                    (!isFieldTouched(form, 'bucketName') && 'nocss') ||
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
                row.onResource(resource, readPolicy);
                return row;
            });
        const writePolicyOptions = resourceList
            .filter(resource => readPolicy.includes(resource.name))
            .map(resource => {
                const { name: value } = resource;
                const { name: icon } = getNamespaceResourceTypeIcon(resource);
                return { value, icon };
            });

        const resourceServiceMapping = mapValues(
            resources,
            resource => resource.service
        );

        this.resources = resources;
        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
        this.readPolicyRows(readPolicyRows);
        this.isWritePolicyDisabled(readPolicy.length === 0);
        this.writePolicyOptions(writePolicyOptions);
        this.resourceServiceMapping = resourceServiceMapping;
        this.isStepValid = isFormValid(form);
        this.readPolicy = readPolicy;
    }

    onBucketName(bucketName) {
        action$.next(updateForm(this.formName, { bucketName }));
    }

    onToggleReadPolicyResource(resource, select) {
        const { readPolicy } = this;
        if (!select) {
            const filtered = readPolicy.filter(name => name !== resource);
            action$.next(updateForm(this.formName, { readPolicy: filtered }));

        } else if (!readPolicy.includes(resource)) {
            const updated = [ ...readPolicy, resource ];
            action$.next(updateForm(this.formName, { readPolicy: updated }));
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
        if (!this.isStepValid) {
            action$.next(touchForm(this.formName, fieldsByStep[step]));
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
}

export default {
    viewModel: CreateNamespaceBucketModalViewModel,
    template: template
};

