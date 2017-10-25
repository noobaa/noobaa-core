/* Copyright (C) 2016 NooBaa */

import template from './bucket-objects-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle } from 'utils/core-utils';
import ObjectRowViewModel from './object-row';
import { navigateTo } from 'actions';
import { routeContext, systemInfo, sessionInfo, bucketObjectList } from 'model';
import { action$ } from 'state';
import { uploadObjects } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'link',
        sortable: 'key'
    },
    {
        name: 'creationTime',
        sortable: 'create_time'
    },
    {
        name: 'size',
        sortable: true
    }
]);

const compareAccessors = deepFreeze({
    key: object => object.name,
    create_time: object => object.create_time,
    size: object => object.size,
});

class BucketObjectsTableViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        this.columns = columns;
        this.pageSize = paginationPageSize;
        this.bucketName = bucketName;

        const objectList = bucketObjectList;
        const bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                bucket => bucket.name === ko.unwrap(bucketName)
            )
        );

        this.objects = ko.pureComputed(
            () => objectList() && objectList().objects
        );

        const notWritable = ko.pureComputed(
            () => !bucket() || !bucket().writable
        );

        const notOwner = ko.pureComputed(
            () => !systemInfo() || systemInfo().owner.email !== sessionInfo().user
        );

        const httpsNoCert = ko.pureComputed(
            () => routeContext().protocol === 'https' &&
                (!systemInfo() || !systemInfo().has_ssl_cert)
        );

        this.uploadDisabled = ko.pureComputed(
            () => notOwner() || notWritable() || httpsNoCert()
        );

        this.uploadTooltip = ko.pureComputed(
            () => {
                if (notOwner()) {
                    return 'This operation is only available for the system owner';
                }

                if (notWritable()) {
                    return 'Cannot upload, not enough healthy storage resources';
                }

                if (httpsNoCert()) {
                    return 'Cannot upload, a certificate must be installed in order to upload via https';
                }

                return '';
            }
        );

        this.fileSelectorExpanded = ko.observable(false);

        this.objectCount = ko.pureComputed(
            () => bucket() && bucket().num_objects
        );

        this.filteredObjectCount = ko.pureComputed(
            () => objectList() && objectList().counters.non_paginated
        );

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sorting = ko.pureComputed({
            read: () => {
                const { sortBy, order } = query();
                const canSort = Object.keys(compareAccessors).includes(sortBy);
                return {
                    sortBy: (canSort && sortBy) || 'key',
                    order: (canSort && Number(order)) || 1
                };
            },
            write: value => this.orderBy(value)
        });

        this.page = ko.pureComputed({
            read: () => Number(query().page) || 0,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterObjects(phrase), inputThrottle)
        });

        this.hasObjects = ko.pureComputed(
            () => this.objects().length > 0
        );
    }

    uploadFiles(files) {
        const { access_key, secret_key } = systemInfo().owner.access_keys[0];
        action$.onNext(uploadObjects(ko.unwrap(this.bucketName), files, access_key, secret_key));
        this.fileSelectorExpanded(false);
    }

    createObjectRow(obj) {
        return new ObjectRowViewModel(obj);
    }

    pageTo(page) {
        let params = Object.assign(
            {
                filter: this.filter(),
                page: page
            },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    filterObjects(phrase) {
        let params = Object.assign(
            {
                filter: phrase || undefined,
                page: 0
            },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    orderBy(sorting) {
        let params = Object.assign(
            {
                filter: this.filter(),
                page: 0
            },
            sorting
        );

        navigateTo(undefined, undefined, params);
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};
