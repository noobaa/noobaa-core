/* Copyright (C) 2016 NooBaa */

import template from './edit-namespace-bucket-data-placement-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { getNamespaceResourceTypeIcon, getNamespaceResourceStateIcon } from 'utils/resource-utils';
import { getFieldValue } from 'utils/form-utils';
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

class ResourceRowViewModel {
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

class EditNamespaceBucketDataPlacementModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    bucketName = '';
    readPolicyTableColumns = readPolicyTableColumns;
    resourceServiceMapping = null;
    fields = ko.observable();
    readPolicyRows = ko.observableArray()
        .ofType(ResourceRowViewModel, { table: this });
    writePolicyOptions = ko.observableArray();
    isWritePolicyDisabled = ko.observable();
    readPolicy = '';

    selectState(state, params) {
        const { namespaceBuckets, namespaceResources, forms } = state;
        const { bucket } = params;

        return [
            namespaceBuckets && namespaceBuckets[bucket],
            namespaceResources,
            forms[this.formName]
        ];
    }

    mapStateToProps(bucket, resources, form ) {
        if (!bucket || !resources) {
            return;
        }

        const { readFrom, writeTo } = bucket.placement;
        const readPolicy = form ? getFieldValue(form, 'readPolicy') : readFrom;
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
            bucketName: bucket.name,
            isWritePolicyDisabled: readPolicy.length === 0,
            readPolicy,
            readPolicyRows,
            writePolicyOptions,
            resourceServiceMapping,
            fields: !form ? {
                readPolicy: readFrom,
                writePolicy: writeTo
            } : undefined
        });

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
        const { readPolicy, formName } = this;
        if (!select) {
            const filtered = readPolicy.filter(name => name !== resource);
            this.dispatch(updateForm(formName, { readPolicy: filtered }));

        } else if (!readPolicy.includes(resource)) {
            const updated = [ ...readPolicy, resource ];
            this.dispatch(updateForm(formName, { readPolicy: updated }));
        }
    }

    onSubmit(values) {
        const { readPolicy, writePolicy } = values;
        this.dispatch(
            closeModal(),
            updateNamespaceBucketPlacement(this.bucketName, readPolicy, writePolicy)
        );

    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditNamespaceBucketDataPlacementModalViewModel,
    template: template
};
