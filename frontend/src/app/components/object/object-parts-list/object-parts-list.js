/* Copyright (C) 2016 NooBaa */

import template from './object-parts-list.html';
import resourceListTooltip from './resource-list-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { openObjectPreviewModal, requestLocation } from 'action-creators';
import { paginationPageSize } from 'config';
import { realizeUri } from 'utils/browser-utils';
import { getCloudResourceTypeIcon } from 'utils/resource-utils';
import { splitObjectId } from 'utils/object-utils';
import { getResiliencyTypeDisplay } from 'utils/bucket-utils';
import { formatSize } from 'utils/size-utils';
import { stringifyAmount, capitalize } from 'utils/string-utils';
import { getHostDisplayName } from 'utils/host-utils';
import numeral from 'numeral';
import ko from 'knockout';
import * as routes from 'routes';
import {
    deepFreeze,
    isUndefined,
    mapValues,
    groupBy,
    countBy,
    createCompareFunc
} from 'utils/core-utils';

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
    'INTERNAL_STORAGE_SET':       'While using the system internal storage, no parity fragments / replicas will be kept regardless of the configured policy parameters',
    'DELETE_SET':                 'In a case of policy changes, data allocation might be changed and some replicas/ fragments will need to be removed'
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
    CANNOT_BE_DELETED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable - Cannot be wipped'
    },
    WAITING_FOR_ALLOCATION: {
        name: 'working',
        css: 'warning',
        tooltip: 'Allocating'
    },
    WAITING_FOR_DELETE: {
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

const specialStorageSets = [
    'INTERNAL_STORAGE_SET',
    'DELETE_SET'
];


const _compareGroupIds = createCompareFunc(pair => {
    const [groupId] = pair;
    return specialStorageSets.indexOf(groupId);
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

function _formatBlockTypeCounters(counters, seperator = ' | ') {
    const {
        REPLICA: replicas = 0,
        DATA: dataFrags = 0,
        PARITY: parityFrags = 0,
        IN_PROCESS: inProcess = 0
    } = counters;

    const parts = [];
    if (replicas > 0) {
        parts.push(stringifyAmount('Replica', replicas));
    }

    if (dataFrags > 0) {
        parts.push(stringifyAmount('Data Fragment', dataFrags));
    }

    if (parityFrags > 0) {
        parts.push(stringifyAmount('Parity Fragment', parityFrags));
    }

    if (inProcess > 0) {
        parts.push(`${stringifyAmount('Block', inProcess)} in process`);
    }

    return parts.join(seperator);
}

function _mapPartToRow(part, index, selectIndex) {
    const seq = numeral(part.seq + 1).format(',');
    const size = formatSize(part.size);

    const distribution = _formatBlockTypeCounters(
        countBy(part.blocks, block =>
            block.mode.startsWith('WAITING') ? 'IN_PROCESS' : block.kind
        )
    );

    return {
        index: index,
        isSelected: index === selectIndex,
        state: partModeToState[part.mode],
        summary: `Part ${seq} | ${size} | ${distribution}`
    };
}

function _getBlockGroupId(block) {
    const { mode, storage, mirrorSet } = block;
    return (
        (mode === 'WAITING_FOR_DELETE' && 'DELETE_SET') ||
        (mode === 'CANNOT_BE_DELETED' && 'DELETE_SET') ||
        (storage.kind === 'INTERNAL_STORAGE' && 'INTERNAL_STORAGE_SET') ||
        mirrorSet
    );
}

function _getGroupTooltip(groupId, blockType, storageType) {
    const parts = [
        specialStorageSets.includes(groupId) ? groupId : 'MIRROR_SET'
    ];

    if (parts[0] === 'MIRROR_SET') {
        parts.push(blockType, storageType);
    }

    const text = groupTooltips[parts.join(':')];
    if (text) {
        return { text, align: 'end' };
    }
}

function _getResourceInfo(resource, cloudTypeMapping, system) {
    const { type, name } = resource;
    switch (type) {
        case 'HOSTS': {
            return {
                icon: 'nodes-pool',
                text: name,
                href: realizeUri(routes.pool, { system, pool: name })
            };
        }

        case 'CLOUD': {
            const cloudType = cloudTypeMapping[name];
            return {
                icon: getCloudResourceTypeIcon({ type: cloudType }).name,
                text: name,
                href: realizeUri(routes.cloudResource, { system, resource: name })
            };
        }
    }
}

function _getStorageSummary(tierIndex, resources, system, cloudTypeMapping) {
    if (tierIndex === -1) {
        return {
            tierIndex: 0,
            resources: null
        };

    } else if (resources.length === 0) {
        return {
            tierIndex: tierIndex + 1,
            resources: null
        };

    } else if (resources.length === 1) {
        return {
            tierIndex: tierIndex + 1,
            resources: _getResourceInfo(resources[0], cloudTypeMapping, system)
        };

    } else {
        return {
            tierIndex: tierIndex + 1,
            resources: {
                text: stringifyAmount('resource', resources.length),
                tooltip: {
                    template: resourceListTooltip,
                    text: resources.map(res =>
                        _getResourceInfo(res, cloudTypeMapping, system)
                    )
                }
            }
        };
    }
}

function _getGroupBlocksType(blockTypeCounters) {
    const { REPLICA = 0, DATA = 0, PARITY = 0 } = blockTypeCounters;
    return (
        (REPLICA === 0 && 'FRAGMENTS') ||
        ((DATA + PARITY) === 0 && 'REPLICAS') ||
        'MIXED'
    );
}

function _listUsedResources(blocks) {
    const map = blocks.reduce((map, block) => {
        const { kind, pool, resource } = block.storage;
        if (kind === 'HOSTS' || kind === 'CLOUD') {
            const type = kind;
            const name = kind === 'HOSTS' ? pool : resource;
            const key = `${type}:${name}`;
            if (!map.has(key)) {
                map.set(key, { name, type });
            }
        }
        return map;
    }, new Map());

    return Array.from(map.values());
}

function _getGroupLabel(groupId, groupIndex) {
    return false ||
        (groupId === 'DELETE_SET' && 'To be removed') ||
        (groupId === 'INTERNAL_STORAGE_SET' && 'Internal storage') ||
        `Mirror set ${groupIndex + 1}`;
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
    const { kind, resource, pool, host } = block.storage;
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
        case 'INTERNAL_STORAGE': {
            return { text: 'Internal Storage' };
        }

        case 'NOT_ALLOCATED': {
            return { text: 'Searching for resource' };
        }
    }
}

function _mapBlockToRow(block, system) {
    return {
        state: blockModeToState[block.mode],
        marking: _getBlockMarking(block),
        resource: _getBlockResource(block, system)
    };
}


function _mapBlocksToTables(blocks, placement, cloudTypeMapping, system) {
    const groups = groupBy(blocks, _getBlockGroupId);

    return Object.entries(groups)
        .sort(_compareGroupIds)
        .map(([groupId, blocks], i) => {
            const blockTypeCounters = countBy(blocks, block => block.kind);
            const blockType = _getGroupBlocksType(blockTypeCounters);
            const blockStorageType = blocks[0].storage.kind;
            const resources = _listUsedResources(blocks);
            const tierIndex = placement.tiers.findIndex(tier =>
                (tier.mirrorSets || []).some(ms => ms.name === groupId)
            );
            const visibleColumns = blocksTableColumns
                .filter(column => !column.visibleFor || column.visibleFor === blockType)
                .map(column => column.name);

            const label = _getGroupLabel(groupId, i);
            const policy = _formatBlockTypeCounters(blockTypeCounters);
            const tooltip = _getGroupTooltip(groupId, blockType, blockStorageType);
            const storage = _getStorageSummary(tierIndex, resources, system, cloudTypeMapping);
            const rows = blocks.map(block => _mapBlockToRow(block, system));

            return { visibleColumns, label, policy, tooltip, storage, rows };
        });
}

function _mapPartDetails(part, placement, cloudTypeMapping, system) {
    if (!part) {
        return;
    }

    return {
        fade: true,
        partSeq: numeral(part.seq + 1).format(','),
        blockTables: _mapBlocksToTables(
            part.blocks,
            placement,
            cloudTypeMapping,
            system
        )
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
    storage = {
        visible: ko.observable(),
        tierIndex: ko.observable(),
        resources: ko.observable()
    };
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
    dataReady = ko.observable();
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

    mapStateToProps(
        location,
        bucket,
        object,
        parts,
        cloudResources,
        user,
        sslCert
    ) {
        if (!parts || !user || !bucket || !object) {
            ko.assignToProps(this, {
                dataReady: false,
                partCount: 0,
                placementType: '',
                resilinecySummary: '',
                resourceCount: '',
                areActionsAllowed: false
            });

        } else {
            const { params, query, protocol, pathname } = location;
            const httpsNoCert = protocol === 'https' && !sslCert;
            const selectedRow = isUndefined(query.row) ? -1 : Number(query.row);
            const selectedPart = selectedRow > -1 ? parts[selectedRow] : null;
            const cloudTypeMapping = mapValues(cloudResources, res => res.type);
            const resourceCount = bucket.placement.tiers.reduce(
                (count, tier) => count + (tier.mirrorSets || []).reduce(
                    (count, ms) => count + ms.resources.length, 0
                ),0
            );

            ko.assignToProps(this, {
                dataReady: true,
                pathname: pathname,
                s3SignedUrl: object.s3SignedUrl,
                partCount: object.partCount,
                resilinecySummary: _summrizeResiliency(bucket.resiliency),
                resourceCount: resourceCount,
                downloadTooltip: _getActionsTooltip(user.isOwner, httpsNoCert, 'download'),
                previewTooltip: _getActionsTooltip(user.isOwner, httpsNoCert, 'preview', 'end'),
                page: Number(query.page || 0),
                areActionsAllowed: user.isOwner && !httpsNoCert,
                selectedRow: selectedRow,
                rows: parts.map((part, i) => _mapPartToRow(part, i, selectedRow)),
                isPaneExpanded: Boolean(selectedPart),
                partDetails: _mapPartDetails(
                    selectedPart,
                    bucket.placement,
                    cloudTypeMapping,
                    params.system
                )
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
