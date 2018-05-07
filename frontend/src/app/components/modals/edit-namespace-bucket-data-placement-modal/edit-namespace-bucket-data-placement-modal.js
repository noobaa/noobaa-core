/* Copyright (C) 2016 NooBaa */

import template from './edit-namespace-bucket-data-placement-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getFieldValue } from 'utils/form-utils';
import { state$, action$ } from 'state';
import { getMany } from 'rx-extensions';
import { closeModal, updateNamespaceBucketPlacement } from 'action-creators';

const formName = 'editNamespaceBucketDataPlacement';

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
    constructor({ bucket }) {
        super();

        this.bucketName = ko.unwrap(bucket);
        this.readPolicyTableColumns = readPolicyTableColumns;
        this.readPolicyRows = ko.observableArray();
        this.writePolicyOptions = ko.observableArray();
        this.isWritePolicyDisabled = ko.observable();
        this.form = null;
        this.isFormReady = ko.observable();

        this.readPolicyRowParams = {
            onToggle: this.onToggleReadPolicyResource.bind(this)
        };

        this.observe(
            state$.pipe(
                getMany(
                    ['namespaceBuckets', this.bucketName],
                    'namespaceResources',
                    ['forms', formName]
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
                const { name: value, service } = resource;
                const { icon, selectedIcon } = getCloudServiceMeta(service);
                return { value, icon, selectedIcon };
            });

        if (!form) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    readPolicy: readFrom,
                    writePolicy: writeTo
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormReady(true);
        }

        this.isWritePolicyDisabled(readPolicy.length === 0);
        this.readPolicyRows(readPolicyRows);
        this.writePolicyOptions(writePolicyOptions);
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

    onToggleReadPolicyResource(resource, select) {
        const { readPolicy } = this.form;
        if (!select) {
            const filtered = readPolicy().filter(name => name !== resource);
            readPolicy(filtered);

        } else if (!readPolicy().includes(resource)) {
            readPolicy([ ...readPolicy(), resource ]);
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

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditNamespaceBucketDataPlacementModalViewModel,
    template: template
};
