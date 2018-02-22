/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-placement-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ResourceRow from './resource-row';
import { state$, action$ } from 'state';
import { deepFreeze, pick, flatMap } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';
import {
    openEmptyBucketPlacementWarningModal,
    updateBucketPlacementPolicy
 } from 'action-creators';

const formName = 'editBucketPlacement';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'selected'
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
        name: 'onlineHostCount',
        label: 'Online Nodes'
    },
    {
        name: 'usage',
        label: 'Used Capacity',
        type: 'capacity'
    }
]);

class EditBucketPlacementModalViewModel extends Observer {
    constructor({ bucketName, onClose }) {
        super();

        this.close = onClose;
        this.columns = columns;
        this.bucketName = ko.unwrap(bucketName);
        this.tierName = '';
        this.isFormInitialized = ko.observable();
        this.form = null;
        this.rows = ko.observableArray();
        this.allResourceNames = [];
        this.isMixedPolicy = false;
        this.isPolicyRisky = false;
        this.spillover = null;

        this.observe(
            state$.getMany(
                ['buckets', ko.unwrap(bucketName)],
                'hostPools',
                'cloudResources',
                ['forms', formName]
            ),
            this.onBucket
        );
    }

    onBucket([ bucket, hostPools, cloudResources, form ]) {
        if (!bucket) {
            this.isFormInitialized(false);
            return;
        }

        const { spillover } = bucket;
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

        const rows = resourceList
            .map((pair, i) => {
                const row = this.rows.get(i) || new ResourceRow(rowParams);
                row.onResource(pair.type,  pair.resource, selectedResources, spillover);
                return row;
            });

        this.spillover = spillover;
        this.resourceList = resourceList;
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
                onWarn: this.onWarn.bind(this),
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
        const ids = this.resourceList
            .filter(item => !this.spillover || this.spillover.name !== item.resource.name)
            .map(pair => ({ type: pair.type, name: pair.resource.name }));

        this.form.selectedResources(ids);
    }

    onClearAll() {
        this.form.selectedResources([]);
    }

    onCancel() {
        this.close();
    }

    onValidate(values) {
        const errors = {};

        const { policyType, selectedResources } = values;
        if (policyType === 'MIRROR' && selectedResources.length === 1) {
            errors.selectedResources = 'Mirror policy requires at least 2 participating pools';
        }

        return errors;
    }

    onWarn(values) {
        const warnings = {};

        const { policyType, selectedResources } = values;
        if (policyType === 'SPREAD') {
            const [ first, ...others ] = selectedResources;
            if (others.some(res => res.type !== first.type)) {
                warnings.selectedResources = 'Configuring node pools combined with cloud resources as a spread policy may cause performance issues';
            }
        }

        return warnings;
    }

    onSubmit(values) {
        this.close();

        let action = updateBucketPlacementPolicy(
            this.bucketName,
            this.tierName,
            values.policyType,
            values.selectedResources.map(val => val.name)
        );

        if (values.selectedResources.length === 0) {
            action = openEmptyBucketPlacementWarningModal(action);
        }

        action$.onNext(action);
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
