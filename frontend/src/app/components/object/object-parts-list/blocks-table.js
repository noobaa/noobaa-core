/* Copyright (C) 2016 NooBaa */

import mirrorsetResourcesTooltip from './mirrorset-resources-tooltip.html';
import { deepFreeze, unique } from 'utils/core-utils';
import BlockRowViewModel from './block-row';
import { formatBlockDistribution } from 'utils/object-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getResourceTypeIcon } from 'utils/resource-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'marking',
        type: 'marking',
        label: 'replicas',
        onlyFor: 'REPLICAS'
    },
    {
        name: 'marking',
        type: 'marking',
        label: 'fragments',
        onlyFor: 'FRAGMENTS'
    },
    {
        name: 'marking',
        type: 'marking',
        label: 'fragments / replicas',
        onlyFor: 'MIXED'
    },
    {
        name: 'resource',
        type: 'newLink',
        label: 'resource'
    }
]);

const tooltips = deepFreeze({
    'MIRROR_SET:REPLICAS:HOSTS':  'Replicas on nodes pool are distributed between the different nodes in the pool according to the configured policy parameters',
    'MIRROR_SET:FRAGMENTS:HOSTS': 'Fragments resides in nodes pool are distributed between the different nodes in the pool according to the configured policy parameters',
    'MIRROR_SET:REPLICAS:CLOUD':  'NooBaa considers cloud resource as resilient and keeps only one replica on this type of resource',
    'MIRROR_SET:FRAGMENTS:CLOUD': 'NooBaa considers cloud resource as resilient and keeps only data fragments on this type of resource',
    'SPILLOVER_SET:REPLICAS':     'The spillover resource is used since the bucket storage is not enough to store new data. Once possible, data will be spilled-back according to the configured policy',
    'SPILLOVER_SET:FRAGMENTS':    'Fragments resides in nodes pool are distributed between the different nodes in the pool according to the configured policy parameters',
    'TO_BE_REMOVED':              'In a case of policy changes, data allocation might be changed and some replicas/ fragments will need to be removed'
});

function _getBlocksCategory(storagePolicy) {
    const { replicas, dataFrags, parityFrags } = storagePolicy;
    return true &&
        (replicas && (dataFrags + parityFrags) && 'MIXED') ||
        (replicas && 'REPLICAS') ||
        'FRAGMENTS';
}

function _getStorageType(group) {
    if (!group.resources) {
        return 'UNKNOWN';
    }

    const types = unique(group.resources.map(res => res.type));
    if (types.length === 1) {
        return types[0];
    }

    const candidate = group.blocks[0];
    if (candidate.storage) {
        return candidate.storage.kind;
    }

    return 'UNKNOWN';
}

function _getColumns(blocksCategory) {
    return columns.filter(column =>
        !column.onlyFor || column.onlyFor === blocksCategory
    );
}

function _getGroupLabel(group) {
    switch (group.type) {
        case 'MIRROR_SET': {
            return `Mirror Set ${group.index + 1}`;
        }

        case 'SPILLOVER_SET': {
            return 'Spillover Set';
        }

        case 'TO_BE_REMOVED': {
            return 'To be removed';
        }
    }
}

function _getTooltip(groupType, blocksCategory, storageType)  {
    const parts = [groupType];

    if (groupType !== 'TO_BE_REMOVED') {
        parts.push(blocksCategory);

        if (groupType !== 'SPILLOVER_SET') {
            parts.push(storageType);
        }
    }

    return {
        text: tooltips[parts.join(':')],
        align: 'end'
    };
}

function _mapResourceData(resource, system) {
    const { type, cloudType } = resource;
    return {
        text: resource.name,
        icon: getResourceTypeIcon(type, { type: cloudType }),
        href: resource.type === 'HOSTS' ? realizeUri(routes.pool, { system, pool: resource.name }) : undefined
    };
}

function _getResourceSummary(resources, system) {
    if (resources.length === 0) {
        return;
    }

    if (resources.length === 1) {
        return _mapResourceData(resources[0], system);
    }

    const resourceList = resources.map(resource => _mapResourceData(resource, system));

    const tooltip = {
        template: mirrorsetResourcesTooltip,
        text: resourceList,
        breakWords: true
    };

    return {
        css: 'box',
        text: stringifyAmount('resource', resources.length),
        tooltip: tooltip
    };
}

export default class BlocksTableViewModel {
    columns = ko.observableArray();
    label = ko.observable();
    policy = ko.observable();
    tooltip = ko.observable();
    resources = ko.observable();
    rows = ko.observableArray();

    onState(distributionGroup, system) {
        const { type, storagePolicy, resources, blocks } = distributionGroup;
        const blocksCategory = _getBlocksCategory(storagePolicy);
        const storageType = _getStorageType(distributionGroup);
        const label = _getGroupLabel(distributionGroup);
        const policy = formatBlockDistribution(storagePolicy);
        const tooltip = _getTooltip(type, blocksCategory, storageType);

        const rows = blocks
            .map((block, i) => {
                const row = this.rows.get(i) || new BlockRowViewModel();
                row.onState(block, system);
                return row;
            });

        this.columns(_getColumns(blocksCategory));
        this.label(label);
        this.policy(policy);
        this.tooltip(tooltip);
        this.resources(_getResourceSummary(resources, system));
        this.rows(rows);
    }
}
