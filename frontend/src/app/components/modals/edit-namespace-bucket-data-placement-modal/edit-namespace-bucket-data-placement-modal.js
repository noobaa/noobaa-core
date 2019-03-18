/* Copyright (C) 2016 NooBaa */

import template from './edit-namespace-bucket-data-placement-modal.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import { getFieldValue } from 'utils/form-utils';
import { state$, action$ } from 'state';
import { getMany } from 'rx-extensions';
import {
    updateForm,
    closeModal,
    updateNamespaceBucketPlacement
} from 'action-creators';

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

class EditNamespaceBucketDataPlacementModalViewModel extends Observer {
    formName = this.constructor.name;
    bucketName = '';
    readPolicyTableColumns = readPolicyTableColumns;
    fields = ko.observable();
    readPolicyRows = ko.observableArray();
    writePolicyOptions = ko.observableArray();
    isWritePolicyDisabled = ko.observable();
    readPolicy = '';
    readPolicyRowParams = { onToggle: this.onToggleReadPolicyResource.bind(this) };

    constructor({ bucket }) {
        super();

        this.bucketName = ko.unwrap(bucket);

        this.observe(
            state$.pipe(
                getMany(
                    ['namespaceBuckets', this.bucketName],
                    'namespaceResources',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([ bucket, resources, form ]) {
        if (!bucket || !resources) return;

        const { readFrom, writeTo } = bucket.placement;
        const readPolicy = form ? getFieldValue(form, 'readPolicy') : readFrom;
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

        this.isWritePolicyDisabled(readPolicy.length === 0);
        this.readPolicy = readPolicy;
        this.readPolicyRows(readPolicyRows);
        this.writePolicyOptions(writePolicyOptions);
        this.resourceServiceMapping = resourceServiceMapping;

        if (!this.fields()) {
            this.fields({
                readPolicy: readFrom,
                writePolicy: writeTo
            });
        }
    }

    onValidate(values) {
        const { readPolicy, writePolicy } = values;
        const errors = {};

        if (readPolicy.length === 0) {
            errors.readPolicy = 'Please select at least one namespace resources';

        } else if (!writePolicy) {
            errors.writePolicy = 'Please select a namespace resource';
        }

        return errors;
    }

    onWarn(values, resourceServiceMapping) {
        const { readPolicy } = values;
        const warnings = {};

        if (readPolicy.length > 1) {
            const firstService = resourceServiceMapping[readPolicy[0]];
            const mixedServices = readPolicy.some(res => resourceServiceMapping[res] !== firstService);

            if (mixedServices) {
                warnings.readPolicy = 'A mixture of different resource services will require to read and re-write the data without optimization';
            }
        }

        return warnings;
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

    onSubmit(values) {
        const { readPolicy, writePolicy } = values;
        action$.next(updateNamespaceBucketPlacement(this.bucketName, readPolicy, writePolicy));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: EditNamespaceBucketDataPlacementModalViewModel,
    template: template
};
