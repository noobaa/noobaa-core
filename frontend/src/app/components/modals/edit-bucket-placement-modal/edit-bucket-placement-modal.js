/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-placement-modal.html';
import Observer from 'observer';
import ResourceRow from './resource-row';
import { state$, action$ } from 'state';
import { deepFreeze, pick, flatMap, createCompareFunc, keyBy } from 'utils/core-utils';
import { unassignedRegionText, getResourceId } from 'utils/resource-utils';
import { getFieldValue } from 'utils/form-utils';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import * as routes from 'routes';
import { editBucketPlacementMirrorTooltip, editBucketPlacementSpreadTooltip } from 'knowledge-base-articles';
import {
    openEmptyBucketPlacementWarningModal,
    updateBucketPlacementPolicy,
    updateForm,
    closeModal
} from 'action-creators';

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
                    href: editBucketPlacementSpreadTooltip
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
                    href: editBucketPlacementMirrorTooltip
                }

            }
        }
    }
]);

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
    formName = this.constructor.name;
    policyTypeOptions = policyTypeOptions;
    columns = columns;
    bucketName = '';
    tierName = '';
    fields = ko.observable();
    rows = ko.observableArray();
    allResourceNames = [];
    isMixedPolicy = false;
    isPolicyRisky = false;
    selectableResourceIds = [];
    resourcesHref = ko.observable();
    rowParams = { onToggle: this.onToggleResource.bind(this) };

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', ko.unwrap(bucketName)],
                    'hostPools',
                    'cloudResources',
                    ['forms', this.formName],
                    ['location', 'params', 'system']
                )
            ),
            this.onState
        );
    }

    onState([bucket, hostPools, cloudResources, form, system]) {
        if (!bucket) {
            this.isFormInitialized(false);
            return;
        }

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

        const selectableResourceIds = resourceList
            .map(pair => ({ type: pair.type, name: pair.resource.name }));

        const rows = resourceList
            .sort(resourceCompareFunc)
            .map((pair, i) => {
                const row = this.rows.get(i) || new ResourceRow(this.rowParams);
                row.onResource(pair.type,  pair.resource, selectedResources);
                return row;
            });

        const regionByResource = keyBy(
            resourceList,
            record => getResourceId(record.type, record.resource.name),
            record => record.resource.region
        );

        const resourcesHref = realizeUri(routes.resources, { system });

        this.tierName = bucket.tierName;
        this.selectedResources = selectedResources;
        this.selectableResourceIds = selectableResourceIds;
        this.regionByResource = regionByResource;
        this.rows(rows);
        this.resourcesHref(resourcesHref);

        if (!this.fields()) {
            const { policyType, mirrorSets } = bucket.placement;
            const resources = flatMap(mirrorSets, ms => ms.resources);
            const selectedResources = resources
                .map(record => pick(record, ['type', 'name']));

            this.fields({ policyType, selectedResources });
        }
    }

    onToggleResource(id, select) {
        const { selectedResources } = this;
        if (!select) {
            const filtered = this.selectedResources
                .filter(another => another.name !== id.name || another.type !== id.type);

            action$.next(updateForm(this.formName, { selectedResources: filtered }));

        } else if (!selectedResources.includes(name)) {
            const updated = [ ...selectedResources, id ];
            action$.next(updateForm(this.formName, { selectedResources: updated }));
        }
    }

    onSelectAll() {
        action$.next(updateForm(this.formName, { selectedResources: this.selectableResourceIds }));
    }

    onClearAll() {
        action$.next(updateForm(this.formName, { selectedResources: [] }));
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
}

export default {
    viewModel: EditBucketPlacementModalViewModel,
    template: template
};
