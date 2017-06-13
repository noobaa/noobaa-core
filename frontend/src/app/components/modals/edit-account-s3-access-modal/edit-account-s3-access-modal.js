/* Copyright (C) 2016 NooBaa */

import template from './edit-account-s3-access-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { updateAccountS3Access } from 'action-creators';
import { flatMap, deepFreeze } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { getCloudServiceMeta } from 'utils/ui-utils';
import ko from 'knockout';

const bucketPermissionModes = deepFreeze([
    {
        label: 'Allow access to all buckets (including all future buckets)',
        value: true
    },
    {
        label: 'Allow access to the following buckets only:',
        value: false
    }
]);

const formName = 'editAccountS3Access';

function mapResourceToOption({ type, name: value, storage }) {
    const { total, free: available_free, unavailable_free } = storage;
    const free = sumSize(available_free, unavailable_free);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const icons = type ? getCloudServiceMeta(type) : { icon: 'nodes-pool' };
    return { ...icons, value, remark };
}

class EditAccountS3AccessModalViewModel extends Observer {
    constructor({ accountName, onClose }) {
        super();

        this.bucketPermissionModes = bucketPermissionModes;
        this.close = onClose;
        this.resourceOptions = ko.observable();
        this.bucketOptions = ko.observable();
        this.isBucketSelectionDisabled = ko.observable();
        this.isAccountReady = ko.observable(false);
        this.form = null;

        this.observe(
            state$.getMany(
                ['accounts', accountName],
                ['nodePools', 'pools'],
                'cloudResources',
                'buckets'
            ),
            this.onState
        );
    }

    onState([ account, nodePools, cloudResources, buckets ]) {
        if (account && !this.isAccountReady()) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    accountName: account.name,
                    hasS3Access: account.hasS3Access,
                    hasAccessToAllBuckets: account.hasAccessToAllBuckets,
                    allowedBuckets: account.allowedBuckets || [],
                    defaultResource: account.defaultResource
                },
                onForm: this.onForm.bind(this),
                onValidate: this.onValidate,
                onSubmit: this.onSubmit.bind(this)
            });
            this.isAccountReady(true);
        }

        this.resourceOptions(flatMap(
            [ nodePools, cloudResources ],
            resources => Object.values(resources).map(mapResourceToOption)
        ));

        this.bucketOptions(Object.keys(buckets));
    }

    onForm(form) {
        if (!form) return;
        const { hasS3Access, hasAccessToAllBuckets } = form.fields;
        this.isBucketSelectionDisabled(!hasS3Access.value || hasAccessToAllBuckets.value);
    }

    onValidate({ hasS3Access, defaultResource }) {
        const errors = {};

        // Validate selected resource
        if (hasS3Access && !defaultResource) {
            errors.defaultResource = 'Please select a default resource for the account';
        }

        return errors;
    }

    onSelectAllBuckets() {
        this.form.allowedBuckets(this.bucketOptions());
    }

    onClearSelectedBuckets() {
        this.form.allowedBuckets([]);
    }

    onSubmit({
        accountName,
        hasS3Access,
        defaultResource,
        hasAccessToAllBuckets,
        allowedBuckets
    }) {

        action$.onNext(updateAccountS3Access(
            accountName,
            hasS3Access,
            defaultResource,
            hasAccessToAllBuckets,
            allowedBuckets
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
    viewModel: EditAccountS3AccessModalViewModel,
    template: template
};
