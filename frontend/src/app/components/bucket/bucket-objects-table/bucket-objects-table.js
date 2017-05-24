/* Copyright (C) 2016 NooBaa */

import template from './bucket-objects-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle } from 'utils/core-utils';
import ObjectRowViewModel from './object-row';
import { navigateTo } from 'actions';
import { routeContext, systemInfo } from 'model';
import { uploadObjects } from 'dispatchers';

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

class BucketObjectsTableViewModel extends BaseViewModel {
    constructor({ bucket, objectList }) {
        super();

        this.columns = columns;
        this.pageSize = paginationPageSize;

        this.objects = ko.pureComputed(
            () => objectList() && objectList().objects.map(
                pair => pair.info
            )
        );

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        const notWritable = ko.pureComputed(
            () => !bucket() || !bucket().writable
        );

        const httpsNoCert = ko.pureComputed(
            () => routeContext().protocol === 'https' &&
                (!systemInfo() || !systemInfo().has_ssl_cert)
        );

        this.uploadDisabled = ko.pureComputed(
            () => notWritable() || httpsNoCert()
        );

        this.uploadTooltip = ko.pureComputed(
            () => {
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
            () => objectList() && objectList().total_count
        );

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
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
        uploadObjects(this.bucketName(), files, access_key, secret_key);
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
