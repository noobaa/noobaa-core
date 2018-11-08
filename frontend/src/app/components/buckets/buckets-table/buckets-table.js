/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import tiersColTooltip from './tiers-col-tooltip.html';
import resourcesColTooltip from './resources-col-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { realizeUri } from 'utils/browser-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount, includesIgnoreCase } from 'utils/string-utils';
import { paginationPageSize, inputThrottle } from 'config';
import {
    deepFreeze,
    flatMap,
    createCompareFunc,
    throttle,
    groupBy
} from 'utils/core-utils';
import {
    getBucketStateIcon,
    getVersioningStateText,
    getResiliencyTypeDisplay,
    flatPlacementPolicy
} from 'utils/bucket-utils';
import {
    requestLocation,
    deleteBucket,
    openCreateBucketModal,
    openConnectAppModal
} from 'action-creators';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: bucket => bucket.mode
    },
    {
        name: 'name',
        label: 'bucket name',
        type: 'link',
        sortable: true,
        compareKey: bucket => bucket.name
    },
    {
        name: 'objectCount',
        label: 'objects',
        sortable: true,
        compareKey: bucket => bucket.objectCount
    },
    {
        name: 'resiliencyPolicy',
        sortable: true,
        compareKey: bucket => bucket.resiliency.kind
    },
    {
        name: 'tiers',
        sortable: true,
        compareKey: bucket => bucket.placement.tiers.length
    },
    {
        name: 'resources',
        label: 'Resources in Tiers',
        type: 'resources-cell',
        sortable: true,
        compareKey: bucket => {
            const resourceTypes = flatPlacementPolicy(bucket)
                .map(record => record.resource.type);

            return (resourceTypes.includes('HOSTS') ? 1 : 0) +
                (resourceTypes.includes('CLOUD') ? 1 : 0);
        }
    },
    {
        name: 'versioning',
        sortable: true,
        compareKey: bucket => bucket.versioning.mode
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true,
        compareKey: bucket => toBytes(bucket.storage.used || 0)
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const createButtondDisabledTooltip = deepFreeze({
    text: 'The current account is not allowed to create new buckets in the system. To grant permissions, edit the account\'s S3 access in the account page',
    align: 'end'
});

const undeletableReasons = deepFreeze({
    LAST_BUCKET: 'The last bucket cannot be deleted',
    NOT_EMPTY: 'Cannot delete a bucket that contains objects or any objects versions'
});

const resourceGroupMetadata = deepFreeze([
    {
        type: 'HOSTS',
        icon: 'nodes-pool',
        subject: 'Node pools',
        uriFor: (resName, system) => realizeUri(
            routes.pool,
            { system, pool: resName }
        )
    },
    {
        type: 'CLOUD',
        icon: 'cloud-hollow',
        subject: 'Cloud resources',
        uriFor: (resName, system) => realizeUri(
            routes.cloudResource,
            { system, resource: resName }
        )
    }
]);

function _mapResiliency(resiliency) {
    const { kind, replicas, dataFrags, parityFrags } = resiliency;
    return `${
        getResiliencyTypeDisplay(kind)
    } (${
        kind === 'REPLICATION' ?
            `${replicas} copies` :
            `${dataFrags}+${parityFrags}`
    })`;
}

function _mapTiers(tiers) {
    const text = stringifyAmount('Tier', tiers.length);
    const tooltip = {
        template: tiersColTooltip,
        text: tiers.map((tier, i) => {
            if (tier.policyType === 'INTERNAL_STORAGE') {
                return {
                    tierIndex: 1,
                    placement: 'No Resources'
                };

            } else {
                const verb = tier.policyType === 'SPREAD' ? 'Spread' : 'Mirrored';
                const resourceCount = flatMap(tier.mirrorSets, ms => ms.resources).length;
                return {
                    tierIndex: i + 1,
                    placement: `${verb} on ${stringifyAmount('resoruce', resourceCount)}`
                };
            }
        })
    };

    return { text, tooltip };
}

function _getResourceGroupTooltip(records, subject, hrefGen, system) {
    if (records.length === 0) {
        return `No ${subject.toLowerCase()}`;
    }

    const byTierIndex = groupBy(
        records,
        record => record.tierIndex
    );

    return {
        template: resourcesColTooltip,
        text: Object.entries(byTierIndex)
            .map(([i, records]) => ({
                subject: subject,
                tierIndex: Number(i) + 1,
                resources: records.map(record => {
                    const { name } = record.resource;
                    const href = hrefGen(name, system);
                    return { name, href };
                })
            }))
    };
}

function _mapResourceGroups(bucket, system) {
    const groups = groupBy(
        flatPlacementPolicy(bucket),
        record => record.resource.type
    );

    return resourceGroupMetadata.map(meta => {
        const { type, icon, subject, uriFor } = meta;
        const group = groups[type] || [];
        return {
            icon: icon,
            lighted: Boolean(group.length),
            tooltip: _getResourceGroupTooltip(group, subject, uriFor, system)
        };
    });
}

function _mapBucket(bucket, system, selectedForDelete) {
    return {
        state: getBucketStateIcon(bucket, 'start'),
        name: {
            text: bucket.name,
            href: realizeUri(routes.bucket, { system, bucket: bucket.name }),
            tooltip: {
                text: bucket.name,
                breakWords: true
            }
        },
        objectCount: numeral(bucket.objectCount).format('0,0'),
        resiliencyPolicy: _mapResiliency(bucket.resiliency),
        resources: _mapResourceGroups(bucket, system),
        tiers: _mapTiers(bucket.placement.tiers),
        versioning: getVersioningStateText(bucket.versioning.mode),
        capacity: {
            total: bucket.storage.total,
            used:bucket.storage.used
        },
        deleteButton: {
            id: bucket.name,
            active: selectedForDelete === bucket.name,
            disabled: Boolean(bucket.undeletable),
            tooltip: bucket.undeletable ? undeletableReasons[bucket.undeletable] : null
        }
    };
}

class RowViewModel {
    table = null;
    name = ko.observable();
    state = ko.observable();
    objectCount = ko.observable();
    resiliencyPolicy = ko.observable();
    tiers = ko.observable();
    resources = ko.observable();
    versioning = ko.observable();
    capacity = {
        total: ko.observable(),
        used: ko.observable()
    };
    deleteButton = {
        text: 'Delete bucket',
        disabled: ko.observable(),
        tooltip: ko.observable(),
        active: ko.observable(),
        id: ko.observable(),
        onDelete: this.onDelete.bind(this),
        onToggle: this.onToggle.bind(this)
    };

    constructor({ table }) {
        this.table = table;
    }

    onToggle(bucketName) {
        this.table.onSelectForDelete(bucketName);
    }

    onDelete(bucketName) {
        this.table.onDelete(bucketName);
    }
}

class BucketsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    BucketsTableViewModel
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    selectedForDelete = ko.observable();
    bucketCount = ko.observable();
    bucketsLoaded = ko.observable();
    createBucketTooltip = ko.observable();
    isCreateBucketDisabled = ko.observable();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this });

    selectState(state) {
        return [
            state.location,
            state.buckets,
            (state.accounts || {})[state.session.user]
        ];
    }

    mapStateToProps(location, buckets, userAccount) {
        const { system, tab = 'data-buckets' } = location.params;
        if (tab !== 'data-buckets') {
            return;

        } else if (!buckets) {
            ko.assignToProps(this, {
                isCreateBucketDisabled: true,
                bucketsLoaded: false
            });

        } else {
            const { pathname, query } = location;
            const { filter = '', sortBy = 'name', selectedForDelete = '' } = query;
            const order = Number(query.order || 1);
            const page = Number(query.page || 0);
            const { compareKey } = columns.find(column => column.name === sortBy);
            const { canCreateBuckets = false } = userAccount;
            const createBucketTooltip = canCreateBuckets ? '' : createButtondDisabledTooltip;
            const bucketList = Object.values(buckets)
                .filter(bucket => includesIgnoreCase(bucket.name, filter));
            const rows = bucketList
                .sort(createCompareFunc(compareKey, order))
                .slice(page * paginationPageSize, (page + 1) * paginationPageSize)
                .map(bucket => _mapBucket(bucket, system, selectedForDelete));

            ko.assignToProps(this, {
                pathname,
                filter,
                sorting: { sortBy, order },
                page,
                selectedForDelete,
                bucketCount: bucketList.length,
                rows,
                createBucketTooltip,
                isCreateBucketDisabled: !canCreateBuckets,
                bucketsLoaded: true
            });
        }
    }

    onCreateBucket() {
        this.dispatch(openCreateBucketModal());
    }

    onConnectApplication() {
        this.dispatch(openConnectAppModal());
    }

    onFilter = throttle(filter => {
        this._query({
            filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

    onSort(sorting) {
        this._query({
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: 0,
            selectedForDelete: null
        });
    }

    onPage(page) {
        this._query({
            page,
            selectedForDelete: null
        });
    }

    onSelectForDelete(bucketName) {
        const selectedForDelete = bucketName || '';
        this._query({ selectedForDelete });
    }

    onDelete(bucketName) {
        this.dispatch(deleteBucket(bucketName));
    }

    _query(query) {
        const {
            filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    template: template,
    viewModel: BucketsTableViewModel
};
