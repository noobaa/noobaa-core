/* Copyright (C) 2016 NooBaa */

import template from './create-namespace-bucket-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, mapValues, throttle } from 'utils/core-utils';
import { validateName } from 'utils/validation-utils';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import { getFieldValue, isFieldTouched, isFormValid } from 'utils/form-utils';
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
    'Set Placement',
    'Set Caching Policy'
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
    1: [ 'readPolicy', 'writePolicy' ],
    2: [ 'cacheTTL' ]
});

class ResourceRowViewModel {
    table = null;
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    target = ko.observable();
    isSelected = ko.observable();
    selected = ko.pureComputed({
        read: this.isSelected,
        write: this.onToggle,
        owner: this
    });

    constructor({ table }) {
        this.table = table;
    }

    onToggle(val) {
        this.table.onToggleReadPolicyResource(this.name(), val);
    }
}

class CreateNamespaceBucketModalViewModel extends ConnectableViewModel {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    steps = steps;
    isStepValid = false;
    existingNames = [];
    nameRestrictionList = ko.observableArray();
    readPolicyTableColumns = readPolicyTableColumns;
    readPolicyRows = ko.observableArray()
        .ofType(ResourceRowViewModel, { table: this });
    isWritePolicyDisabled = ko.observable();
    writePolicyOptions = ko.observableArray();
    resourceServiceMapping = {};
    readPolicy = [];
    writePolicy = '';
    enableCaching = ko.observable(false);

    fields = {
        step: 0,
        bucketName: '',
        readPolicy: [],
        writePolicy: undefined,
        cacheTTL: 60000,
        enableCaching: false
    };

    selectState(state) {
        return [
            state.buckets,
            state.namespaceBuckets,
            state.namespaceResources,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(buckets, namespaceBuckets, resources, form) {
        if (!buckets || !namespaceBuckets || !resources || !form) {
            return;
        }

        const bucketName = getFieldValue(form, 'bucketName');
        const readPolicy = getFieldValue(form, 'readPolicy');
        const writePolicy = getFieldValue(form, 'writePolicy');
        const cacheTTL = getFieldValue(form, 'cacheTTL');
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
        const readPolicyRows = resourceList.map(resource => ({
            state: getNamespaceResourceStateIcon(resource),
            type: getNamespaceResourceTypeIcon(resource),
            name: resource.name,
            target: resource.target,
            isSelected: readPolicy.includes(resource.name)
        }));
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

        ko.assignToProps(this, {
            resources,
            existingNames,
            nameRestrictionList,
            readPolicyRows,
            isWritePolicyDisabled: readPolicy.length === 0,
            writePolicyOptions,
            resourceServiceMapping,
            isStepValid: isFormValid(form),
            readPolicy,
            writePolicy,
            cacheTTL
        });

    }

    onBucketName = throttle(
        bucketName => this.dispatch(updateForm(this.formName, { bucketName })),
        inputThrottle,
        this
    );

    onToggleReadPolicyResource(resource, select) {
        const { readPolicy, writePolicy, formName } = this;
        if (!select) {
            const filtered = readPolicy.filter(name => name !== resource);
            this.dispatch(updateForm(formName, {
                readPolicy: filtered,
                writePolicy: resource === writePolicy ? '' : undefined
            }));

        } else if (!readPolicy.includes(resource)) {
            const updated = [ ...readPolicy, resource ];
            this.dispatch(updateForm(formName, { readPolicy: updated }));
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

    onWarn(values, resourceServiceMapping) {
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
            this.dispatch(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onSubmit(values) {
        const { bucketName, readPolicy, writePolicy, cacheTTL } = values;
        this.dispatch(
            closeModal(),
            createNamespaceBucket(bucketName, readPolicy, writePolicy,
                this.enableCaching() ? {
                    ttl_ms: cacheTTL
                } : undefined)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: CreateNamespaceBucketModalViewModel,
    template: template
};

