/* Copyright (C) 2016 NooBaa */

import template from './create-bucket-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ResourceRow from './resource-row';
import { state$, action$ } from 'state';
import { getMany } from 'rx-extensions';
import { updateForm, updateModal, closeModal, createBucket } from 'action-creators';
import ko from 'knockout';
import { getFieldValue, isFieldTouched } from 'utils/form-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

const steps = deepFreeze([
    {
        label: 'choose name',
        size: 'small'
    },
    {
        label: 'set policy',
        size: 'large'
    }
]);

const resourceColumns = deepFreeze([
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
        name: 'name'
    },
    {
        name: 'healthyHosts',
        label: 'Healthy Nodes'
    },
    {
        name: 'healthyNodes',
        label: 'Healthy Drives'
    },
    {
        name: 'usage',
        label: 'Used Capacity',
        type: 'capacity'
    }
]);

function _validatedName(name = '', existing) {
    return [
        {
            valid: 3 <= name.length && name.length <= 63,
            message: '3-63 characters'
        },
        {
            valid: /^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        {
            valid: name && /^[a-z0-9.-]*$/.test(name) &&
                !name.includes(' ') &&
                !name.includes('..') &&
                !name.includes('.-') &&
                !name.includes('-.') &&
                !name.includes('--'),
            message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
        },
        {
            valid: name && !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid the form of an IP address'
        },
        {
            valid: name && !existing.includes(name),
            message: 'Globally unique name'
        }
    ];
}

class CreateBucketModalViewModel extends Observer {
    steps = steps.map(step => step.label);
    stepSize = steps[0].size;
    resourceColumns = resourceColumns;
    formName = this.constructor.name;
    form = null;
    nameRestrictionList = ko.observable();
    existingNames = [];
    resourceRows = ko.observableArray();
    selectableResourceIds = [];
    rowParams = {
        onToggle: this.onToggleResource.bind(this)
    };

    constructor() {
        super();

        this.form = new FormViewModel({
            name: this.formName,
            fields: {
                step: 0,
                bucketName: '',
                policyType: 'SPREAD',
                selectedResources: []
            },
            groups: {
                0: ['bucketName'],
                1: ['policyType', 'selectedResources']
            },
            onValidate: values => this.onValidate(values, this.existingNames),
            onSubmit: this.onSubmit.bind(this)
        });

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'hostPools',
                    'cloudResources',
                    ['forms', this.formName],
                    ['location', 'params', 'system']
                )
            ),
            this.onState
        );
    }

    onState([buckets, hostPools, cloudResources, form, system]) {
        if (!buckets || !hostPools || !cloudResources || !form) return;

        const existingNames = Object.keys(buckets);
        const step = getFieldValue(form, 'step');
        const bucketName = getFieldValue(form, 'bucketName');
        const selectedResources = getFieldValue(form, 'selectedResources');
        const nameRestrictionList = _validatedName(bucketName, existingNames)
            .map(({ valid, message }) => ({
                label: message,
                css: isFieldTouched(form, 'bucketName') ? (valid ? 'success' : 'error') : ''
            }));

        const resourceList = [
            ...Object.values(hostPools)
                .map(resource => ({ type: 'HOSTS', resource })),
            ...Object.values(cloudResources)
                .map(resource => ({ type: 'CLOUD', resource }))
        ];

        const selectableResourceIds = resourceList
            .map(pair => ({ type: pair.type, name: pair.resource.name }));

        const resourceRows = resourceList
            .map((pair, i) => {
                const row = this.resourceRows.get(i) || new ResourceRow(this.rowParams);
                row.onState(pair.type, pair.resource, selectedResources);
                return row;
            });



        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
        this.selectableResourceIds = selectableResourceIds;
        this.resourceRows(resourceRows);
        this.resourcesHref = realizeUri(routes.resources, { system });

        const { size } = steps[step];
        if (size !== this.stepSize) {
            this.stepSize = size;
            action$.next(updateModal({ size }));
        }
    }

    onValidate(values, existingNames) {
        const { step, bucketName, policyType, selectedResources } = values;
        const errors = {};

        if (step === 0) {
            const hasNameErrors = _validatedName(bucketName, existingNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.bucketName = '';
            }

        } else if (step === 1) {
            if (policyType === 'MIRROR' && selectedResources.length === 1) {
                errors.selectedResources = 'Mirror policy requires at least 2 participating pools';

            } else if (policyType === 'SPREAD') {
                const [ first, ...others ] = selectedResources;
                if (others.some(res => res.type !== first.type)) {
                    errors.selectedResources = 'Configuring nodes pools combined with cloud resource as spread is not allowed';
                }
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.form.isValid()) {
            this.form.touch(step);
            return false;
        }

        return true;
    }

    onSelectAll() {
        action$.next(updateForm(
            this.formName,
            { selectedResources: this.selectableResourceIds }
        ));
    }

    onClearAll() {
        action$.next(updateForm(
            this.formName,
            { selectedResources: [] }
        ));
    }

    onToggleResource(id, select) {
        const { selectedResources } = this.form;
        if (!select) {
            const filtered = selectedResources()
                .filter(another => another.name !== id.name || another.type !== id.type);

            selectedResources(filtered);

        } else if (!selectedResources().includes(name)) {
            selectedResources([ ...selectedResources(), id ]);
        }
    }

    onCancel() {
        action$.next(closeModal());
    }

    onSubmit(values) {
        const { bucketName, policyType, selectedResources } = values;
        const resourceNames = selectedResources.map(pair => pair.name);

        action$.next(createBucket(bucketName, policyType, resourceNames));
        action$.next(closeModal());
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }

}

export default {
    viewModel: CreateBucketModalViewModel,
    template: template
};
