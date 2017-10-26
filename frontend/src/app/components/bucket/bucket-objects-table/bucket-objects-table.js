/* Copyright (C) 2016 NooBaa */

import template from './bucket-objects-table.html';
import Observer from 'observer';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import ObjectRowViewModel from './object-row';
import { state$, action$ } from 'state';
import * as routes from 'routes';
import numeral from 'numeral';
import { uploadObjects, requestLocation, deleteBucketObject } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: object => Boolean(object.size)
    },
    {
        name: 'key',
        label: 'File Name',
        type: 'newLink',
        sortable: true,
        compareKey: object => object.key
    },
    {
        name: 'creationTime',
        sortable: true,
        compareKey: object => object.createTime
    },
    {
        name: 'size',
        sortable: true,
        compareKey: object => object.size
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

function _getStateFilterOptions(all, completed, uploading) {
    return [
        {
            value: 'ALL',
            label: `All Files (${numeral(all).format('0,0')})`
        },
        {
            value: 'COMPLETED',
            label: `Completed (${numeral(completed).format('0,0')})`
        },
        {
            value: 'UPLOADING',
            label: `Uploading (${numeral(uploading).format('0,0')})`
        }
    ];
}

function _getUploadTooltip(isOwner, isBucketWritable, httpsNoCert) {
    if (!isOwner) {
        return 'This operation is only available for the system owner';
    }

    if (!isBucketWritable) {
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
        this.bucket = ko.observable();
        this.objectsLoaded = ko.observable();
        this.rows = ko.observableArray();
        this.uploadDisabled = ko.observable();
        this.uploadTooltip = ko.observable();
        this.fileSelectorExpanded = ko.observable();
        this.objectCount = ko.observable();
        this.stateFilterOptions = ko.observableArray();
        this.stateFilter = ko.observable();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
        this.pageSize = paginationPageSize;
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.page = ko.observable();
        this.selectedForDelete = ko.observable();
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
                ['env', 'hasSslCert']
            ),
            this.onBucketObjects
        );
    }

    onBucketObjects([bucket, bucketObjects, user, accounts, location, hasSslCert]) {
        if(!bucket || !bucketObjects || !accounts) {
            this.stateFilterOptions(_getStateFilterOptions(0, 0, 0));
            this.uploadDisabled(true);
            this.objectsLoaded(false);
            return;
        }

        const { isOwner, hasS3Access, accessKeys } = accounts[user];
        const bucketObjectsList = Object.values(bucketObjects.objects);
        const { system } = location.params;
        const { state='ALL', filter = '', sortBy = 'key', order = 1, page = 0, selectedForDelete } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const rowParams = {
            baseRoute: realizeUri(routes.object, { system, bucket: bucket.name }, {}, true),
            deleteGroup: this.deleteGroup,
            onDelete: this.onDeleteBucketObject.bind(this)
        };
        const { nonPaginated, completed, uploading } = bucketObjects.counters;

        this.accessKeys = hasS3Access && accessKeys;
        this.stateFilterOptions(_getStateFilterOptions(completed + uploading, completed, uploading));
        this.fileSelectorExpanded(false);
        const httpsNoCert = location.protocol === 'https' && !hasSslCert;
        this.uploadDisabled(!isOwner || !bucket.writable || httpsNoCert);
        this.uploadTooltip(_getUploadTooltip(isOwner, bucket.writable, httpsNoCert));

        const rows = bucketObjectsList
            .sort(createCompareFunc(compareKey, order))
            .map((bucketObject, i) => {
                const row = this.rows.get(i) || new ObjectRowViewModel(rowParams);
                row.onBucketObject(bucketObject, isOwner, bucket.writable);
                return row;
            });

        this.pathname = location.pathname;
        this.stateFilter(state);
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete(selectedForDelete);
        this.objectCount(nonPaginated);
        this.rows(rows);
        this.objectsLoaded(true);
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
        console.warn('state', state);
        this._query({
            state: state,
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
            state = this.stateFilter()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined,
            state: state
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(selected) {
        const selectedForDelete = this.selectedForDelete() === selected ? null : selected;
        this._query({ selectedForDelete });
    }

    onDeleteBucketObject(object) {
        const { accessKey, secretKey } = this.accessKeys;
        action$.onNext(deleteBucketObject(ko.unwrap(this.bucketName), object, accessKey, secretKey));
    }

    uploadFiles(files) {
        const { accessKey, secretKey } = this.accessKeys;
        action$.onNext(uploadObjects(ko.unwrap(this.bucketName), files, accessKey, secretKey));
        this.fileSelectorExpanded(false);
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};
