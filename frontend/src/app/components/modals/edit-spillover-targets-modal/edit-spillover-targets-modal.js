/* Copyright (C) 2016 NooBaa */

import template from './edit-spillover-targets-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { updateBucketsSpillover } from 'action-creators';
import ko from 'knockout';

const formName = 'editSpilloverTargets';

class EditSpilloverTargetsModalViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.buckets = ko.observable();
        this.selectedBuckets = ko.observableArray();
        this.isSpilloverTargetsReady = ko.observable(false);
        this.form = null;

        this.observe(state$.get('buckets'), this.onBuckets);
    }

    onBuckets(buckets) {
        const bucketsList = Object.values(buckets);
        if (bucketsList.length && !this.isSpilloverTargetsReady()) {

            this.form = new FormViewModel({
                name: formName,
                onSubmit: this.onSubmit.bind(this)
            });
            this.isSpilloverTargetsReady(true);
            this.buckets(bucketsList);
            bucketsList.map(bucket => {
                if(!bucket.backingResources.spillover[0].disabled) {
                    this.selectedBuckets.push(bucket.name);
                }
            });
        }
    }

    onSelectAllBuckets() {
        this.form.allowedBuckets(this.bucketOptions());
    }

    onClearSelectedBuckets() {
        this.form.allowedBuckets([]);
    }

    onSubmit() {
        const bucketsSpillover = this.buckets().map(bucket => ({
            name: bucket.name,
            spilloverEnabled: this.selectedBuckets().includes(bucket.name)
        }));

        action$.onNext(updateBucketsSpillover(
            bucketsSpillover
        ));

        this.close();
    }

    onCancel() {
        this.close();
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