/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-spillover-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import numeral from 'numeral';
import { state$, action$ } from 'state';
import { flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { getCloudResourceTypeIcon } from 'utils/resource-utils';
import { getMany } from 'rx-extensions';
import { getInternalResourceDisplayName } from 'utils/resource-utils';
import { closeModal, updateBucketSpilloverPolicy } from 'action-creators';
import { editBucketSpillover as learnMoreHref } from 'knowledge-base-articles';

function _getResourceTypeIcon(type, resource) {
    switch (type) {
        case 'HOSTS': {
            return {
                icon: 'nodes-pool',
                selectedIcon: 'nodes-pool'
            };
        }

        case 'CLOUD': {
            const { name } = getCloudResourceTypeIcon(resource);
            return {
                icon: `${name}-dark`,
                selectedIcon: `${name}-colored`
            };
        }

        case 'INTERNAL': {
            return {
                icon: 'internal-storage',
                selectedIcon: 'internal-storage'
            };
        }
    }
}

function _getOptionTooltip(type, resource, isOptionDisabled) {
    if (isOptionDisabled) {
        return {
            text: 'Resource is already used for bucket data placement',
            position: 'before'
        };
    }

    const isHostsPool = type === 'HOSTS';
    const hostSummary = isHostsPool ? `${
        numeral(resource.hostsByMode.OPTIMAL || 0).format(',')
    } / ${
        numeral(resource.hostCount).format(',')
    }` : '';

    const { free, unavailableFree, total } = resource.storage;
    const usage = type === 'CLOUD' ?
        formatSize(total) :
        `${formatSize(sumSize(free, unavailableFree))} of ${formatSize(total)}`;

    return {
        template: 'propertySheet',
        position: 'before',
        text: [
            {
                label: 'Healthy nodes',
                value: hostSummary,
                visible: isHostsPool
            },
            {
                label: 'Region',
                value: resource.region || '(Unassigned)',
                visible: type !== 'INTERNAL'
            },
            {
                label: 'Available Capacity',
                value: usage
            }
        ]
    };
}

function _getResourceOptions(resources, usedResources, type) {
    return Object.values(resources)
        .map(resource => {
            const disabled = usedResources.has(resource.name);
            const tooltip = _getOptionTooltip(type, resource, disabled);
            const { icon, selectedIcon } = _getResourceTypeIcon(type, resource);
            const label = type === 'INTERNAL' ? getInternalResourceDisplayName(resource) : resource.name;

            return {
                type,
                label,
                value: resource.name,
                icon,
                selectedIcon,
                disabled,
                tooltip
            };
        });
}

class EditBucketSpilloverModalViewModel extends Observer {
    formName = this.constructor.name;
    bucketName = '';
    resourceOptions = ko.observableArray();
    fields = ko.observable();
    learnMoreHref = learnMoreHref;

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', this.bucketName],
                    'hostPools',
                    'cloudResources',
                    'internalResources'
                )
            ),
            this.onState
        );
    }

    onState([bucket, hostPools, cloudResources, internalResources]) {
        if (!bucket || !hostPools || !cloudResources || !internalResources) {
            return;
        }

        const { spillover, placement } = bucket;
        const usedResources = new Set(flatMap(
            placement.mirrorSets,
            ms => ms.resources.map(resource =>resource.name)
        ));

        const optionList = [
            ..._getResourceOptions(cloudResources, usedResources, 'CLOUD'),
            ..._getResourceOptions(hostPools, usedResources, 'HOSTS'),
            ..._getResourceOptions(internalResources, usedResources, 'INTERNAL')
        ];

        this.resourceOptions(optionList);
        this.internalResourceNames = Object.values(internalResources)
            .map(resource => resource.name);

        if (!this.fields()) {
            this.fields({
                useSpillover: Boolean(spillover),
                target: spillover ? spillover.name : ''
            });
        }
    }

    onValidate(values) {
        const errors = {};

        const { target, useSpillover } = values;

        if (useSpillover && !target) {
            errors.target = 'Please select a resource from the list';
        }

        return errors;
    }

    onWarn(values, spilloverResources) {
        const warnings = {};

        const { target, useSpillover } = values;

        if (useSpillover && target && spilloverResources.includes(target)) {
            warnings.target = 'Using system internal storage resource is not recommended';
        }

        return warnings;
    }

    onSubmit(values) {
        const { target, useSpillover } = values;
        const resource = useSpillover ? target : null;
        action$.next(updateBucketSpilloverPolicy(this.bucketName, resource));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: EditBucketSpilloverModalViewModel,
    template: template
};
