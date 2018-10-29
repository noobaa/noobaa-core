/* Copyright (C) 2016 NooBaa */

import template from './create-bucket-modal.html';
import Observer from 'observer';
import ResourceRow from './resource-row';
import { state$, action$ } from 'state';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import { getFieldValue, isFieldTouched, isFormValid } from 'utils/form-utils';
import { deepFreeze, keyBy } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { unassignedRegionText, getResourceId } from 'utils/resource-utils';
import * as routes from 'routes';
import { createBucketMirrorTooltip, createBucketSpreadTooltip } from 'knowledge-base-articles';
import {
    updateForm,
    touchForm,
    updateModal,
    closeModal,
    createBucket
} from 'action-creators';

const steps = deepFreeze([
    {
        label: 'choose name',
        size: 'small'
    },
    {
        label: 'set policy',
        size: 'xlarge'
    }
]);

const policyTypeOptions = deepFreeze([
    {
        policyType: 'SPREAD',
        label: 'Spread',
        description: 'Spreading the data across the chosen resources, does not include failure tolerance in case of resource failure',
        tooltip: {
            template: 'checkList',
            text: {
                list: [
                    {
                        text: 'Copies/fragments across the underlying resources for each of the object parts',
                        checked: true
                    },
                    {
                        text: 'Includes failure tolerance in case of resource failure',
                        checked: false
                    }
                ],
                link: {
                    text: 'Learn more about spread policy',
                    href: createBucketSpreadTooltip
                }

            }
        }
    },
    {
        policyType: 'MIRROR',
        label: 'Mirror',
        description: 'Full duplication of the data in each chosen resource, includes failure tolerance in case of resource failure',
        tooltip: {
            template: 'checkList',
            text: {
                list: [
                    {
                        text: 'Copies/fragments across the underlying resources for each of the object parts',
                        checked: true
                    },
                    {
                        text: 'Includes failure tolerance in case of resource failure',
                        checked: true
                    }
                ],
                link: {
                    text: 'Learn more about mirror policy',
                    href: createBucketMirrorTooltip
                }
            }
        }
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
        name: 'region'
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

const fieldsByStep = deepFreeze({
    0: ['bucketName'],
    1: ['policyType', 'selectedResources']
});

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
    formName = this.constructor.name;
    policyTypeOptions = policyTypeOptions;
    steps = steps.map(step => step.label);
    stepSize = steps[0].size;
    resourceColumns = resourceColumns;
    nameRestrictionList = ko.observable();
    existingNames = [];
    resourceRows = ko.observableArray();
    selectableResourceIds = [];
    fields = {
        step: 0,
        bucketName: '',
        policyType: 'SPREAD',
        selectedResources: []
    };
    rowParams = {
        onToggle: this.onToggleResource.bind(this)
    };

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'hostPools',
                    'cloudResources',
                    ['location', 'params', 'system'],
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([buckets, hostPools, cloudResources, system,  form]) {
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

        const regionByResource = keyBy(
            resourceList,
            record => getResourceId(record.type, record.resource.name),
            record => record.resource.region
        );


        this.existingNames = existingNames;
        this.nameRestrictionList(nameRestrictionList);
        this.selectableResourceIds = selectableResourceIds;
        this.resourceRows(resourceRows);
        this.resourcesHref = realizeUri(routes.resources, { system });
        this.selectedResources = selectedResources;
        this.isStepValid = isFormValid(form);
        this.regionByResource = regionByResource;

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

    onWarn(values, regionByResource) {
        const warnings = {};
        const { policyType, selectedResources } = values;

        if (policyType === 'SPREAD') {
            const [first, ...rest] = selectedResources
                .map(({ type, name }) => regionByResource[getResourceId(type, name)] || unassignedRegionText);

            if (first && rest.some(region => region !== first)) {
                warnings.selectedResources = 'Combining resources with different assigned regions is not recommended and might raise costs';
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
        const { selectedResources } = this;
        if (!select) {
            const filtered = selectedResources
                .filter(another => another.name !== id.name || another.type !== id.type);

            action$.next(updateForm(this.formName, { selectedResources: filtered }));

        } else if (!selectedResources.includes(name)) {
            const updated = [ ...selectedResources, id ];
            action$.next(updateForm(this.formName, { selectedResources: updated }));
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
}

export default {
    viewModel: CreateBucketModalViewModel,
    template: template
};
