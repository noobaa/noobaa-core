/* Copyright (C) 2016 NooBaa */

import template from './object-parts-list.html';
import resourceListTooltip from './resource-list-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { openObjectPreviewModal, requestLocation } from 'action-creators';
import { paginationPageSize } from 'config';
import { deepFreeze, assignWith, sumBy, isDefined, unique, mapValues } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getCloudResourceTypeIcon } from 'utils/resource-utils';
import { splitObjectId, summerizePartDistribution, formatBlockDistribution } from 'utils/object-utils';
import { getResiliencyTypeDisplay } from 'utils/bucket-utils';
import { formatSize } from 'utils/size-utils';
import { stringifyAmount, capitalize } from 'utils/string-utils';
import { getHostDisplayName } from 'utils/host-utils';
import numeral from 'numeral';
import ko from 'knockout';
import * as routes from 'routes';

const partModeToState = deepFreeze({
    UNAVAILABLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    },
    BUILDING: {
        name: 'working',
        css: 'warning',
        tooltip:'Rebuilding'
    },
    AVAILABLE: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const groupTooltips = deepFreeze({
    'MIRROR_SET:REPLICAS:HOSTS':  'Replicas on nodes pool are distributed between the different nodes in the pool according to the configured policy parameters',
    'MIRROR_SET:FRAGMENTS:HOSTS': 'Fragments resides in nodes pool are distributed between the different nodes in the pool according to the configured policy parameters',
    'MIRROR_SET:REPLICAS:CLOUD':  'NooBaa considers cloud resource as resilient and keeps only one replica on this type of resource',
    'MIRROR_SET:FRAGMENTS:CLOUD': 'NooBaa considers cloud resource as resilient and keeps only data fragments on this type of resource',
    'TO_BE_REMOVED':              'In a case of policy changes, data allocation might be changed and some replicas/ fragments will need to be removed'
});

const blocksTableColumns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'replicas',
        prop: 'marking',
        type: 'marking',
        visibleFor: 'REPLICAS'
    },
    {
        name: 'fragments',
        prop: 'marking',
        type: 'marking',
        visibleFor: 'FRAGMENTS'
    },
    {
        name: 'mixed',
        prop: 'marking',
        type: 'marking',
        label: 'fragments / replicas',
        visibleFor: 'MIXED'
    },
    {
        name: 'resource',
        type: 'link',
        label: 'resource'
    }
]);

const blockModeToState = deepFreeze({
    NOT_ACCESSIBLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    },
    MOCKED: {
        name: 'working',
        css: 'warning',
        tooltip: 'Allocating'
    },
    WIPING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Wiping'
    },
    HEALTHY: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

function _summrizeResiliency(resiliency) {
    const { kind, replicas, dataFrags, parityFrags } = resiliency;
    const counts = kind === 'ERASURE_CODING' ?
        [dataFrags, parityFrags].join(' + ') :
        replicas;

    return `${getResiliencyTypeDisplay(kind)} (${counts})`;
}

function _getActionsTooltip(isOwner, httpsNoCert, verb, align) {
    if (!isOwner) {
        return {
            text: `${capitalize(verb)} is only available for the system owner`,
            align: align
        };

    }

    if (httpsNoCert) {
        return {
            text: `A certificate must be installed in order to ${verb} the file via https`,
            align: align
        };
    }

    return '';
}

function _mapPart(part, index, distribution, isSelected) {
    const seq = numeral(part.seq + 1).format(',');
    const size = formatSize(part.size);
    const counters = {
        replicas: 0,
        dataFrags: 0,
        parityFrags: 0,
        toBeRemoved: 0
    };

    for (const group of distribution) {
        if (group.type === 'TO_BE_REMOVED') {
            counters.toBeRemoved +=  sumBy(Object.values(group.storagePolicy));
        } else {
            assignWith(counters, group.storagePolicy, (a, b) => a + b);
        }
    }

    return {
        index,
        isSelected: isSelected,
        summary: `Part ${seq} | ${size} | ${formatBlockDistribution(counters, ', ')}`,
        state: partModeToState[part.mode]
    };
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

function _getGroupTooltip(group, storageType, blocksCategory) {
    const parts = [group.type];
    if (group.type !== 'TO_BE_REMOVED') {
        parts.push(blocksCategory);
    }

    return {
        text: groupTooltips[parts.join(':')],
        align: 'end'
    };
}

function _getResourceInfo(resource, cloudTypeMapping, system) {
    const { type, name } = resource;
    if (type === 'HOSTS') {
        return {
            icon: 'nodes-pool',
            text: name,
            href: realizeUri(routes.pool, { system, pool: name })
        };

    } else {
        const cloudType = cloudTypeMapping[name];
        return {
            icon: getCloudResourceTypeIcon({ type: cloudType }).name,
            text: name,
            href: realizeUri(routes.cloudResource, { system, resource: name })
        };
    }
}

function _getResourceSummary(resources, system, cloudTypeMapping) {
    switch (resources.length) {
        case 0: {
            return;
        }

        case 1: {
            return _getResourceInfo(resources[0], cloudTypeMapping, system);
        }

        default: {
            return {
                text: stringifyAmount('resource', resources.length),
                tooltip: {
                    template: resourceListTooltip,
                    text: resources.map(res => _getResourceInfo(res, cloudTypeMapping, system))
                }
            };
        }
    }
}

function _getBlockMarking(block) {
    switch (block.kind) {
        case 'REPLICA': {
            return {
                text: 'R',
                tooltip: 'Replica'
            };
        }

        case 'DATA': {
            const digit = block.seq + 1;
            return {
                text: `D${digit}`,
                tooltip: `Data Fragment ${digit}`
            };

        }
        case 'PARITY': {
            const digit = block.seq + 1;
            return {
                text: `P${digit}`,
                tooltip: `Parity Fragment ${digit}`
            };
        }
    }

    const letter = block.kind[0];
    const digit = block.seq == null ? '' : (block.seq + 1);
    return `${letter}${digit}`;
}

function _getBlockResource(block, system) {
    if (block.mode === 'MOCKED') {
        return { text: 'Searching for resource' };
    }

    const { kind, resource, pool, host } = block.storage || {};
    switch (kind) {
        case 'HOSTS': {
            const text = getHostDisplayName(host);
            const href = realizeUri(routes.host, { system, pool, host });
            return { text, href };
        }

        case 'CLOUD': {
            const text = resource;
            const href = realizeUri(routes.cloudResource, { system, resource });
            return { text, href };
        }

        case 'INTERNAL': {
            return { text: 'Internal Storage' };
        }
    }
}

function _mapDistributionGroup(group, cloudTypeMapping, system) {
    const policy = group.storagePolicy;
    const blocksCategory =
        (policy.replicas && (policy.dataFrags + policy.parityFrags) && 'MIXED') ||
        (policy.replicas && 'REPLICAS') ||
        'FRAGMENTS';

    const visibleColumns = blocksTableColumns
        .filter(col => col.prop !== 'marking' || col.name === blocksCategory.toLowerCase())
        .map(col => col.name);

    const groupLabel =
        (group.type === 'MIRROR_SET' && `Mirror set ${group.index + 1}`) ||
        (group.type === 'TO_BE_REMOVED' && 'To be removed');

    return {
        visibleColumns: visibleColumns,
        label: groupLabel,
        policy: formatBlockDistribution(policy),
        tooltip: _getGroupTooltip(group.type, blocksCategory, _getStorageType(group)),
        resources: _getResourceSummary(group.resources, system, cloudTypeMapping),
        rows: group.blocks.map(block => ({
            state: blockModeToState[block.mode],
            marking: _getBlockMarking(block),
            resource: _getBlockResource(block, system)
        }))
    };
}

class PartRowViewModel {
    list = null;
    index = -1;
    css = ko.observable();
    state = ko.observable();
    summary = ko.observable();
    isSelected = ko.observable();

    constructor({ list }) {
        this.list = list;
    }

    onMoreDetails() {
        this.list.onSelectRow(this.index);
    }
}

class BlockRowViewModel {
    state = ko.observable();
    marking = ko.observable();
    resource = ko.observable();
}

class BlocksTableViewModel {
    columns = blocksTableColumns;
    visibleColumns = ko.observableArray();
    label = ko.observable();
    policy = ko.observable();
    tooltip = ko.observable();
    resources = ko.observable();
    rows = ko.observableArray()
        .ofType(BlockRowViewModel);
}

class PartDetailsViewModel {
    list = null;
    fade = ko.observable();
    partSeq = ko.observable();
    blockTables = ko.observableArray()
        .ofType(BlocksTableViewModel)

    constructor({ list }) {
        this.list = list;
    }

    onAnimationEnd() {
        this.fade(false);
    }

    onX() {
        this.list.onCloseDetails();
    }
}

class ObjectPartsListViewModel extends ConnectableViewModel {
    pageSize = paginationPageSize;
    pathname = '';
    selectedRow = -1;
    partsLoaded = ko.observable();
    page = ko.observable();
    s3SignedUrl = ko.observable();
    partCount = ko.observable();
    placementType = ko.observable();
    resilinecySummary = ko.observable();
    resourceCount = ko.observable();
    downloadTooltip = ko.observable();
    previewTooltip = ko.observable();
    isPaneExpanded = ko.observable();
    areActionsAllowed = ko.observable();
    actionsTooltip = ko.observable();
    partDetails = ko.observable()
        .ofType(PartDetailsViewModel, { list: this });
    rows = ko.observableArray()
        .ofType(PartRowViewModel, { list: this });

    selectState(state, params) {
        const { bucket: bucketName } = splitObjectId(params.objectId);
        const { location, buckets, objects, objectParts,
            cloudResources, accounts, system } = state;


        return [
            location,
            buckets && buckets[bucketName],
            objects && objects.items[params.objectId],
            objectParts && objectParts.items,
            cloudResources,
            accounts && accounts[state.session.user],
            system && system.sslCert
        ];
    }

    mapStateToProps(location, bucket, object, parts, cloudResources, user, sslCert) {
        if (!parts || !user) {
            ko.assignToProps(this, {
                partsLoaded: false,
                areActionsAllowed: false
            });

        } else if (!bucket || !object) {
            ko.assignToProps(this, {
                partCount: 0,
                placementType: '',
                resilinecySummary: '',
                resourceCount: '',
                partsLoaded: false,
                areActionsAllowed: false
            });

        } else {
            const { params, query, protocol, pathname } = location;
            const httpsNoCert = protocol === 'https' && !sslCert;
            const partDistributions = parts.map(part => summerizePartDistribution(bucket, part));
            const selectedRow = isDefined(query.row) ? Number(query.row) : -1;
            const isRowSelected = selectedRow > -1;
            const cloudTypeMapping = mapValues(cloudResources, res => res.type);
            const resourceCount = bucket.placement2.tiers.reduce(
                (count, tier) => count + tier.mirrorSets.reduce(
                    (count, ms) => count + ms.resources.length,
                    0
                ),
                0
            );

            ko.assignToProps(this, {
                partsLoaded: true,
                pathname: pathname,
                s3SignedUrl: object.s3SignedUrl,
                partCount: object.partCount,
                placementType: 'TODO: Need to figure out What should go here ???',
                resilinecySummary: _summrizeResiliency(bucket.resiliency),
                resourceCount: resourceCount,
                downloadTooltip: _getActionsTooltip(user.isOwner, httpsNoCert, 'download'),
                previewTooltip: _getActionsTooltip(user.isOwner, httpsNoCert, 'preview', 'end'),
                page: Number(query.page || 0),
                areActionsAllowed: user.isOwner && !httpsNoCert,
                selectedRow: selectedRow,
                rows: parts.map((part, i) =>
                    _mapPart(part, i, partDistributions[i], selectedRow === i)
                ),
                isPaneExpanded: isRowSelected,
                partDetails: !isRowSelected ? {} : {
                    fade: true,
                    partSeq: isRowSelected ? numeral(parts[selectedRow].seq + 1).format(',') : '',
                    blockTables: partDistributions[selectedRow].map(group =>
                        _mapDistributionGroup(group, cloudTypeMapping, params.system)
                    )
                }
            });
        }
    }

    onPreviewFile() {
        this.dispatch(openObjectPreviewModal(this.s3SignedUrl()));
    }

    onDownloadClick() {
        // If action are not allowed we prevent the default action
        // on the download link.
        return this.areActionsAllowed();
    }

    onSelectRow(row) {
        if (row === this.selectedRow) {
            return;
        }

        this._query({ page: this.page(), row });
    }

    onPage(page) {
        this._query({ page });
    }

    onCloseDetails() {
        this._query({ page: this.page() });
    }

    _query(query) {
        const url = realizeUri(this.pathname, null, query);
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: ObjectPartsListViewModel,
    template: template
};
