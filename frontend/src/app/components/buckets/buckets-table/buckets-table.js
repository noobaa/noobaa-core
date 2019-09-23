/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import resourcesColTooltip from './resources-col-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { realizeUri } from 'utils/browser-utils';
import { toBytes } from 'utils/size-utils';
import { stringifyAmount, includesIgnoreCase } from 'utils/string-utils';
import { paginationPageSize, inputThrottle } from 'config';
import {
    deepFreeze,
    flatMap,
    createCompareFunc,
    throttle
} from 'utils/core-utils';
import {
    getBucketStateIcon,
    getVersioningStateText,
    getResiliencyTypeDisplay
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
        compareKey: bucket => bucket.objects.count
    },
    {
        name: 'resiliencyPolicy',
        sortable: true,
        compareKey: bucket => bucket.resiliency.kind
    },
    {
        name: 'resources',
        label: 'Resources in Tiers',
        sortable: true,
        compareKey: bucket => {
            const { tiers, resources } = _countTiersAndResources(bucket);
            return [tiers,resources];
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
    NOT_EMPTY: 'Cannot delete a bucket that contains objects or any objects versions'
});

const resourceGroupMetadata = deepFreeze({
    HOSTS: {
        icon: 'nodes-pool',
        getHref: (resName, system) => realizeUri(
            routes.pool,
            { system, pool: resName }
        )
    },
    CLOUD: {
        icon: 'cloud-hollow',
        getHref: (resName, system) => realizeUri(
            routes.cloudResource,
            { system, resource: resName }
        )
    }
});

function _countTiersAndResources(bucket) {
    const { tiers } = bucket.placement;
    const resources = flatMap(
        tiers.filter(tier => tier.policyType !== 'INTERNAL_STORAGE'),
        tier => flatMap(tier.mirrorSets, ms => ms.resources)
    );
    return {
        tiers: tiers.length,
        resources: resources.length
    };
}

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

function _getResourceGroupTooltip(tiers, system) {
    const resourceListPerTier = tiers.map(tier =>
        flatMap(tier.mirrorSets || [], ms => ms.resources)
    );

    return {
        template: resourcesColTooltip,
        text: resourceListPerTier.map((list, i) => ({
            tierIndex: i + 1,
            resources: list.map(resource => {
                const { name, type } = resource;
                const { getHref, icon } = resourceGroupMetadata[type];
                const href = getHref(name, system);
                return { icon, name, href };
            })
        }))
    };
}

function _mapResources(bucket, system) {
    const { tiers, resources } = _countTiersAndResources(bucket);
    const text = `${stringifyAmount('Tier', tiers)}, ${stringifyAmount('Resource', resources)}`;
    const tooltip = _getResourceGroupTooltip(bucket.placement.tiers, system);
    return { text, tooltip };
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
        objectCount: numeral(bucket.objects.count).format(','),
        resiliencyPolicy: _mapResiliency(bucket.resiliency),
        resources: _mapResources(bucket, system),
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
    pathname = '';
    dataReady = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    pageSize = ko.observable();
    selectedForDelete = ko.observable();
    bucketCount = ko.observable();
    createBucketTooltip = ko.observable();
    isCreateBucketDisabled = ko.observable();
    isObjectStatsVisible = ko.observable();
    objectStatsLastUpdate = ko.observable();
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
                isObjectStatsVisible: false,
                dataReady: false
            });

        } else {
            const { pathname, query } = location;
            const { filter = '', sortBy = 'name', selectedForDelete = '' } = query;
            const order = Number(query.order) || 1;
            const page = Number(query.page) || 0;
            const pageSize = Number(query.pageSize) || paginationPageSize.default;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const { canCreateBuckets = false } = userAccount;
            const createBucketTooltip = canCreateBuckets ? '' : createButtondDisabledTooltip;
            const bucketList = Object.values(buckets)
                .filter(bucket => includesIgnoreCase(bucket.name, filter));
            const rows = bucketList
                .sort(createCompareFunc(compareKey, order))
                .slice(page * pageSize, (page + 1) * pageSize)
                .map(bucket => _mapBucket(bucket, system, selectedForDelete));
            const objectStatsLastUpdate = Math.max(
                ...bucketList.map(bucket => bucket.objects.lastUpdate),
                0
            );

            ko.assignToProps(this, {
                pathname,
                filter,
                sorting: { sortBy, order },
                page,
                pageSize,
                selectedForDelete,
                bucketCount: bucketList.length,
                rows,
                createBucketTooltip,
                isCreateBucketDisabled: !canCreateBuckets,
                isObjectStatsVisible: bucketList.length > 0,
                objectStatsLastUpdate: moment(objectStatsLastUpdate).fromNow(),
                dataReady: true
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

    onPageSize(pageSize) {
        this._query({
            pageSize,
            page: 0,
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
            pageSize = this.pageSize(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            filter: filter || undefined,
            sortBy,
            order,
            page,
            pageSize,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    template: template,
    viewModel: BucketsTableViewModel
};
