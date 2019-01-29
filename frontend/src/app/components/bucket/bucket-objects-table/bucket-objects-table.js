/* Copyright (C) 2016 NooBaa */

import template from './bucket-objects-table.html';
import Observer from 'observer';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle, pick } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { isBucketWritable } from 'utils/bucket-utils';
import { splitObjectId } from 'utils/object-utils';
import ObjectRowViewModel from './object-row';
import { state$, action$ } from 'state';
import * as routes from 'routes';
import numeral from 'numeral';
import { get, getMany } from 'rx-extensions';
import {
    uploadObjects,
    requestLocation,
    deleteObject,
    fetchObjects,
    dropObjectsView
} from 'action-creators';

const showVersionsTooltip = 'All the existing object versions that this bucket contains.';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'key',
        label: 'Object Name',
        type: 'link',
        sortable: true
    },
    {
        name: 'versionId',
        label: 'Version ID'
    },
    {
        name: 'creationTime',
        sortable: 'create_time'
    },
    {
        name: 'size',
        sortable: true
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const emptyMessages = deepFreeze({
    NO_MATCHING_KEYS: 'The current filter does not match any object',
    NO_RESULTS: 'This page does not contain any objects',
    NO_OBJECTS: 'No objects in bucket',
    NO_LATEST: 'All latest versions are delete markers',
    NO_UPLOADS: 'No ongoing uploads in bucket'
});

function _getItemsCountByState(counters, state) {
    const { optimal, uploading } = counters;

    switch (state) {
        case 'ALL':
            return optimal + uploading;
        case 'OPTIMAL':
            return optimal;
        case 'UPLOADING':
            return uploading;
    }
}

function _getStateFilterOptions(counters) {
    return [
        {
            value: 'ALL',
            label: `All Objects (${
                numeral(_getItemsCountByState(counters, 'ALL')).format('0,0')
            })`
        },
        {
            value: 'OPTIMAL',
            label: `Completed (${
                numeral(_getItemsCountByState(counters, 'OPTIMAL')).format('0,0')
            })`
        },
        {
            value: 'UPLOADING',
            label: `Uploading (${
                numeral(_getItemsCountByState(counters, 'UPLOADING')).format('0,0')
            })`
        }
    ];
}

function _getUploadTooltip(isOwner, isReadOnly, httpsNoCert) {
    if (!isOwner) {
        return {
            align: 'end',
            text: 'This operation is only available for the system owner'
        };
    }

    if (isReadOnly) {
        return {
            align: 'end',
            text: 'Cannot upload, not enough healthy storage resources'
        };
    }

    if (httpsNoCert) {
        return {
            align: 'end',
            text: 'Cannot upload, a certificate must be installed in order to upload via https'
        };
    }

    return '';
}

class BucketObjectsTableViewModel extends Observer {
    viewName = this.constructor.name;
    showVersionsTooltip = showVersionsTooltip;
    columns = columns;
    visibleColumns = ko.observableArray();
    baseRoute = '';
    bucketName = '';
    currQuery = null;
    currBucket = null;
    bucket = ko.observable();
    objectsLoaded = ko.observable();
    isShowVersionsVisible = ko.observable();
    rows = ko.observableArray();
    uploadButton = ko.observable();
    fileSelectorExpanded = ko.observable();
    objectCount = ko.observable();
    stateFilterOptions = ko.observableArray();
    stateFilter = ko.observable();
    showVersions = ko.observable();
    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
    pageSize = paginationPageSize;
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    emptyMessage = ko.observable();
    selectedForDelete = ko.observable();
    bucketObjects = {};

    constructor({ bucketName }) {
        super();

        this.viewName = this.constructor.name;
        this.columns = columns;
        this.baseRoute = '';
        this.bucketName = ko.unwrap(bucketName);
        this.currQuery = null;
        this.currBucket = null;
        this.bucket = ko.observable();
        this.objectsLoaded = ko.observable();
        this.rows = ko.observableArray();
        this.uploadButton = ko.observable();
        this.fileSelectorExpanded = ko.observable();
        this.objectCount = ko.observable();
        this.stateFilterOptions = ko.observableArray();
        this.stateFilter = ko.observable();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
        this.pageSize = paginationPageSize;
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.page = ko.observable();
        this.selectedForDelete = '';
        this.emptyMessage = ko.observable();
        this.bucketObjects = {};

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', this.bucketName],
                    'objects',
                    ['session', 'user'],
                    ['accounts'],
                    ['system', 'sslCert']
                )
            ),
            this.onState
        );
    }

    onLocation(location) {
        const { tab, bucket, system } = location.params;
        if (!bucket || tab !== 'objects') return;

        const {
            stateFilter = 'ALL',
            filter = '',
            sortBy = 'key',
            order = 1,
            page = 0,
            showVersions = false,
            selectedForDelete
        } = location.query || {};

        const baseRoute = realizeUri(
            routes.object,
            { system, bucket: bucket },
            {},
            true
        );

        this.baseRoute = baseRoute;
        this.filter(filter);
        this.stateFilter(stateFilter);
        this.showVersions(showVersions);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete = selectedForDelete;

        action$.next(fetchObjects(
            this.viewName,
            {
                bucket: bucket,
                filter,
                sortBy: sortBy,
                order: Number(order),
                skip: Number(page) * paginationPageSize,
                limit: paginationPageSize,
                stateFilter,
                versions: showVersions
            },
            location.hostname
        ));
    }

    onState([bucket, bucketObjects, user, accounts, sslCert]) {
        const queryKey = bucketObjects.views[this.viewName];
        const query = bucketObjects.queries[queryKey];

        if (!query || !query.result || !bucket || !user || !accounts) {
            this.uploadButton({});
            this.objectsLoaded(false);
            this.rows([]);
            return;
        }

        const isVersionedBucket = bucket.versioning.mode !== 'DISABLED';
        const showVersionColumn =
            isVersionedBucket &&
            this.showVersions() &&
            this.stateFilter() !== 'UPLOADING';

        const visibleColumns = this.columns.map(col => col.name)
            .filter(name => showVersionColumn || name !== 'versionId');

        const account = accounts[user];
        const { counters, items: queryObjects, emptyReason } = query.result;
        const s3Connection = account.hasS3Access ? {
            accessKey: account.accessKeys.accessKey,
            secretKey: account.accessKeys.secretKey,
            endpoint: location.hostname
        } : null;
        const rowParams = {
            baseRoute: this.baseRoute,
            onSelectForDelete: this.onSelectForDelete.bind(this),
            onDelete: this.onDeleteBucketObject.bind(this)
        };
        const modeFilterOptions = _getStateFilterOptions(counters);
        const httpsNoCert = location.protocol === 'https' && !sslCert;
        const isReadOnly = !isBucketWritable(bucket);
        const uploadButton = {
            disabled: !account.isOwner || isReadOnly || httpsNoCert,
            tooltip: _getUploadTooltip(account.isOwner, isReadOnly, httpsNoCert)
        };

        const rows = queryObjects
            .map((bucketObjectKey, i) => {
                const row = this.rows.get(i) || new ObjectRowViewModel(rowParams);
                const obj = bucketObjects.items[bucketObjectKey];
                row.onState(
                    bucketObjectKey,
                    obj,
                    !account.isOwner,
                    isVersionedBucket,
                    this.showVersions(),
                    this.selectedForDelete
                );
                return row;
            });

        this.isShowVersionsVisible(isVersionedBucket);
        this.visibleColumns(visibleColumns);
        this.s3Connection = s3Connection;
        this.stateFilterOptions(modeFilterOptions);
        this.fileSelectorExpanded(false);
        this.uploadButton(uploadButton);
        this.pathname = location.pathname;
        this.objectCount(_getItemsCountByState(counters, this.stateFilter()));
        this.rows(rows);
        this.emptyMessage(emptyMessages[emptyReason]);
        this.objectsLoaded(true);
    }

    onFilter(filter) {
        this._query({
            filter: filter,
            page: 0,
            selectedForDelete: null
        });
    }

    onFilterByState(state) {
        this._query({
            stateFilter: state,
            page: 0,
            selectedForDelete: null
        });
    }

    onShowVersions(state) {
        this._query({
            showVersions: state,
            page: 0,
            selectedForDelete: null
        });
    }

    onSort(sorting) {
        this._query({
            sorting,
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

    _query(params) {
        const {
            filter = this.filter(),
            sorting = this.sorting(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete(),
            stateFilter = this.stateFilter(),
            showVersions = this.showVersions()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page || undefined,
            selectedForDelete: selectedForDelete || undefined,
            stateFilter: stateFilter,
            showVersions: showVersions || undefined
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(selected) {
        this._query({ selectedForDelete: selected });
    }

    onDeleteBucketObject(id) {
        const objId = this.showVersions() ?
            splitObjectId(id) :
            pick(splitObjectId(id), ['bucket', 'key', 'uploadId']);

        action$.next(deleteObject(objId, this.s3Connection));
    }

    uploadFiles(files) {
        action$.next(uploadObjects(ko.unwrap(this.bucketName), files, this.s3Connection));
        this.fileSelectorExpanded(false);
    }

    dispose() {
        action$.next(dropObjectsView(this.viewName));
        super.dispose();
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};


