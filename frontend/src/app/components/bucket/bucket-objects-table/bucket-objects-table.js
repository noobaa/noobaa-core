/* Copyright (C) 2016 NooBaa */

import template from './bucket-objects-table.html';
import Observer from 'observer';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle, hashCode } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { isBucketWritable } from 'utils/bucket-utils';
import ObjectRowViewModel from './object-row';
import { state$, action$ } from 'state';
import * as routes from 'routes';
import numeral from 'numeral';
import {
    uploadObjects,
    requestLocation,
    deleteBucketObject,
    fetchBucketObjects
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'key',
        label: 'File Name',
        type: 'newLink',
        sortable: true
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
            label: `All Files (${
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

function _getObjectQuery(bucket, query) {
    const {
        stateFilter = 'ALL',
        filter = '',
        sortBy = 'key',
        order = 1,
        page = 0
    } = query || {};

    return {
        bucket: bucket,
        filter,
        sortBy: sortBy,
        order: Number(order),
        skip: Number(page) * paginationPageSize,
        limit: paginationPageSize,
        stateFilter
    };
}

function _getUploadTooltip(isOwner, isReadOnly, httpsNoCert) {
    if (!isOwner) {
        return 'This operation is only available for the system owner';
    }

    if (isReadOnly) {
        return 'Cannot upload, not enough healthy storage resources';
    }

    if (httpsNoCert) {
        return 'Cannot upload, a certificate must be installed in order to upload via https';
    }

    return '';
}

class BucketObjectsTableViewModel extends Observer {
    constructor({ bucketName }) {
        super();

        this.columns = columns;
        this.bucketName = bucketName;
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
        this.emptyMessage = ko.observable();
        this.selectedForDelete = ko.observable();
        this.bucketObjects = {};
        this.deleteGroup = ko.pureComputed({
            read: this.selectedForDelete,
            write: val => this.onSelectForDelete(val)
        });

        this.observe(
            state$.getMany(
                ['buckets', ko.unwrap(bucketName)],
                'bucketObjects',
                ['session', 'user'],
                ['accounts'],
                'location',
                ['system', 'sslCert']
            ),
            this.onState
        );
    }

    onState([bucket, bucketObjects, user, accounts, location, sslCert]) {
        if (location.params.tab != 'objects') {
            this.uploadButton({});
            this.objectsLoaded(false);
            return;
        }

        const query = _getObjectQuery(location.params.bucket, location.query);
        const queryKey = hashCode(query);
        const bucketObjectsQuery = bucketObjects.queries[queryKey];

        if (!bucket || !bucketObjects || !user || !accounts || !bucketObjectsQuery || !bucketObjectsQuery.result) {
            this.uploadButton({});
            this.objectsLoaded(false);
        } else {
            const account = accounts[user];
            const { system } = location.params;
            const { stateFilter = 'ALL', filter = '', sortBy = 'key' } = location.query;
            const page = Number(location.query.page || 0);
            const order = Number(location.query.order || 0);
            const { counters, objects: queryObjects } = bucketObjectsQuery.result;
            const s3Connection = account.hasS3Access ? {
                accessKey: account.accessKeys.accessKey,
                secretKey: account.accessKeys.secretKey,
                endpoint: location.hostname
            } :
            null;
            const rowParams = {
                baseRoute: realizeUri(routes.object, { system, bucket: bucket.name }, {}, true),
                deleteGroup: this.deleteGroup,
                onDelete: this.onDeleteBucketObject.bind(this)
            };
            const modeFilterOptions = _getStateFilterOptions(counters);
            const httpsNoCert = location.protocol === 'https' && !sslCert;
            const isReadOnly = !isBucketWritable(bucket);
            const uploadButton = {
                disabled: !account.isOwner || isReadOnly || httpsNoCert,
                tooltip: _getUploadTooltip(account.isOwner, isReadOnly, httpsNoCert)
            };
            const emptyMessage = (!filter && stateFilter === 'ALL') ?
                'No files in bucket' :
                'The current filter does not match any files in bucket';


            const rows = queryObjects
                .map((bucketObjectKey, i) => {
                    const row = this.rows.get(i) || new ObjectRowViewModel(rowParams);
                    const { bucket, key, uploadId } = bucketObjects.items[bucketObjectKey];
                    row.onState(
                        bucketObjects.items[bucketObjectKey],
                        bucketObjectKey,
                        !account.isOwner,
                        [bucket, key, uploadId]
                    );
                    return row;
                });

            this.s3Connection = s3Connection;
            this.stateFilterOptions(modeFilterOptions);
            this.fileSelectorExpanded(false);
            this.uploadButton(uploadButton);
            this.pathname = location.pathname;
            this.stateFilter(stateFilter);
            this.filter(filter);
            this.sorting({ sortBy, order: Number(order) });
            this.page(page);
            this.selectedForDelete(location.query.selectedForDelete);
            this.objectCount(_getItemsCountByState(counters, stateFilter));
            this.rows(rows);
            this.objectsLoaded(true);
            this.emptyMessage(emptyMessage);
        }

        if (this.currBucket !== bucket ||this.currQuery !== queryKey) {
            this.currBucket = bucket;
            this.currQuery = queryKey;
            action$.onNext(fetchBucketObjects(query));
        }
    }

    onFilter(filter) {
        this._query({
            filter: filter,
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

    onFilterByState(state) {
        this._query({
            stateFilter: state,
            page: 0,
            selectedForDelete: null
        });
    }

    _query(params) {
        const {
            filter = this.filter(),
            sorting = this.sorting(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete(),
            stateFilter = this.stateFilter()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page || undefined,
            selectedForDelete: selectedForDelete || undefined,
            stateFilter: stateFilter
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(selected) {
        const selectedForDelete = this.selectedForDelete() === selected ? null : selected;
        this._query({ selectedForDelete });
    }

    onDeleteBucketObject(bucket, key, uploadId) {
        action$.onNext(deleteBucketObject(bucket, key, uploadId, this.s3Connection));
    }

    uploadFiles(files) {
        action$.onNext(uploadObjects(ko.unwrap(this.bucketName), files, this.s3Connection));
        this.fileSelectorExpanded(false);
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};
