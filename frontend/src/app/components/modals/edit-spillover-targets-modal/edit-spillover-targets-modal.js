/* Copyright (C) 2016 NooBaa */

import template from './edit-spillover-targets-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import BucketRowViewModel from './bucket-row';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, echo, mapValues, createCompareFunc, keyBy } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { paginationPageSize } from 'config';
import { closeModal, toggleBucketsSpillover } from 'action-creators';

const formName = 'editSpilloverTargets';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'status',
        type: 'icon',
        sortable: true,
        compareKey: bucket => bucket.mode
    },
    {
        name : 'name',
        sortable: true,
        compareKey: bucket => bucket.name
    },
    {
        name: 'placement',
        label: 'Bucket Policy',
        sortable: true,
        compareKey: bucket => {
            const { policyType, resources } = bucket.placement;
            return [ policyType, resources.length ];
        }
    },
    {
        name: 'usage',
        label: 'Bucket Usage',
        type: 'capacity',
        sortable: true,
        compareKey: bucket => toBytes(bucket.storage.used)
    }
]);

class EditSpilloverTargetsModalViewModel extends Observer {
    constructor() {
        super();

        this.pageSize = paginationPageSize;
        this.columns = columns;
        this.visibleBuckets = null;
        this.bucketCount = ko.observable();
        this.selectedCount = ko.observable();
        this.sorting = ko.observable();
        this.rows = ko.observableArray();
        this.form = null;
        this.isFormInitalized = ko.observable();

        this.rowParams = {
            onToggle: this.onToogleBucket.bind(this)
        };

        this.observe(
            state$.getMany('buckets', ['forms', formName]),
            this.onState
        );
    }

    onState([ buckets, form ]) {
        if (!buckets) {
            this.isFormInitalized(false);
            return;
        }

        const bucketList = Object.values(buckets);
        const bucketCount = bucketList.length;

        // const bucketWithSpillover = bucketList
        //         .filter(bucket => bucket.spillover)
        //         .map(bucket => bucket.name);

        const {
            page = 0,
            sorting = { sortBy: 'name', order: 1 },
            selection = mapValues(buckets, bucket => Boolean(bucket.spillover))
        } = form ? mapValues(form.fields, field => field.value) : {};

        const selectedCount = Object.values(selection)
            .filter(echo)
            .length;


        const { compareKey } = columns.find(column => column.name === sorting.sortBy);
        const pageStart = page * this.pageSize;
        const bucketsOnPage = bucketList
            .sort(createCompareFunc(compareKey, sorting.order))
            .slice(pageStart, pageStart + this.pageSize);

        const rows = bucketsOnPage
            .map((bucket, i) => {
                const row = this.rows.get(i) || new BucketRowViewModel(this.rowParams);
                row.onBucket(bucket, selection[bucket.name]);
                return row;
            });

        this.visibleBuckets = bucketsOnPage.map(bucket => bucket.name);
        this.bucketCount(bucketCount);
        this.selectedCount(selectedCount);
        this.rows(rows);

        if (!form) {
            this.form = new FormViewModel({
                name: formName,
                fields: { sorting, page, selection },
                onSubmit: this.onSubmit.bind(this)
            });

            this.isFormInitalized(true);
        }
    }

    onToogleBucket(bucket, select) {
        const selection = {
            ...this.form.selection(),
            [bucket]: select
        };

        this.form.selection(selection);
    }

    onSelectAll() {
        const selection = {
            ...this.form.selection(),
            ...keyBy(this.visibleBuckets, echo, () => true)
        };

        this.form.selection(selection);
    }

    onClearAll() {
        const selection = {
            ...this.form.selection(),
            ...keyBy(this.visibleBuckets, echo, () => false)
        };

        this.form.selection(selection);
    }

    onClearSelection() {
        const selection = mapValues(this.form.selection(), () => false);
        this.form.selection(selection);
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    onSubmit(values) {
        action$.onNext(toggleBucketsSpillover(values.selection));
        action$.onNext(closeModal());
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditSpilloverTargetsModalViewModel,
    template: template
};
