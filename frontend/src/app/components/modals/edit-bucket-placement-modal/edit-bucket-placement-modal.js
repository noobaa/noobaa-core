/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-placement-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ResourceRow from './resource-row';
import { state$, action$ } from 'state';
import { deepFreeze, pick, flatMap, createCompareFunc } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import {
    openEmptyBucketPlacementWarningModal,
    updateBucketPlacementPolicy,
    updateForm,
    closeModal
} from 'action-creators';

const formName = 'editBucketPlacement';

const columns = deepFreeze([
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

const resourceCompareFunc = createCompareFunc(record => {
    const { type, resource } = record;
    const kind =
        (type === 'HOSTS' && 'HOSTS') ||
        (type === 'CLOUD' && resource.service) ||
        '';

    return [
        resource.mode,
        kind,
        resource.name
    ];
}, 1);

class EditBucketPlacementModalViewModel extends Observer {
    columns = columns;
    bucketName = '';
    tierName = '';
    isFormInitialized = ko.observable();
    form = null;
    rows = ko.observableArray();
    allResourceNames = [];
    isMixedPolicy = false;
    isPolicyRisky = false;
    spilloverResource = '';
    selectableResourceIds = [];

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', ko.unwrap(bucketName)],
                    'hostPools',
                    'cloudResources',
                    ['forms', formName]
                )
            ),
            this.onState
        );
    }

    onState([ bucket, hostPools, cloudResources, form ]) {
        if (!bucket) {
            this.isFormInitialized(false);
            return;
        }

        const { name: spilloverResource } = bucket.spillover || {};
        const poolList = Object.values(hostPools)
            .map(resource => ({ type: 'HOSTS', resource }));

        const cloudList = Object.values(cloudResources)
            .map(resource => ({ type: 'CLOUD', resource }));

        const resourceList = [
            ...poolList,
            ...cloudList
        ];

        const selectedResources = form ?
            getFieldValue(form, 'selectedResources') :
            [];

        const rowParams = {
            onToggle: this.onToggleResource.bind(this)
        };

        const selectableResourceIds = resourceList
            .filter(pair => pair.resource.name !== spilloverResource)
            .map(pair => ({ type: pair.type, name: pair.resource.name }));

        const rows = resourceList
            .sort(resourceCompareFunc)
            .map((pair, i) => {
                const row = this.rows.get(i) || new ResourceRow(rowParams);
                row.onResource(pair.type,  pair.resource, selectedResources, spilloverResource);
                return row;
            });

        this.spilloverResource = spilloverResource;
        this.selectableResourceIds = selectableResourceIds;
        this.rows(rows);

        if (!form) {
            const { policyType, mirrorSets } = bucket.placement;
            const resources = flatMap(mirrorSets, ms => ms.resources);
            const selectedResources = resources
                .map(record => pick(record, ['type', 'name']));

            this.tierName = bucket.tierName;
            this.form = new FormViewModel({
                name: formName,
                fields: { policyType, selectedResources },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitialized(true);
        }
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

    onSelectAll() {
        action$.next(updateForm(formName, { selectedResources: this.selectableResourceIds }));
    }

    onClearAll() {
        action$.next(updateForm(formName, { selectedResources: [] }));
    }

    onCancel() {
        action$.next(closeModal());
    }

    onValidate(values) {
        const errors = {};

        const { policyType, selectedResources } = values;
        if (policyType === 'MIRROR' && selectedResources.length === 1) {
            errors.selectedResources = 'Mirror policy requires at least 2 participating pools';

        } else if (policyType === 'SPREAD') {
            const [ first, ...others ] = selectedResources;
            if (others.some(res => res.type !== first.type)) {
                errors.selectedResources = 'Configuring nodes pools combined with cloud resource as spread is not allowed';
            }
        }

        return errors;
    }

    onSubmit(values) {
        let action = updateBucketPlacementPolicy(
            this.bucketName,
            this.tierName,
            values.policyType,
            values.selectedResources.map(val => val.name)
        );

        if (values.selectedResources.length === 0) {
            action$.next(openEmptyBucketPlacementWarningModal(action));

        } else {
            action$.next(action);
            action$.next(closeModal());
        }
    }

    dispose(){
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditBucketPlacementModalViewModel,
    template: template
};
