/* Copyright (C) 2016 NooBaa */

import template from './edit-account-s3-access-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { updateAccountS3Access, closeModal } from 'action-creators';
import { flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';

const s3PlacementToolTip = 'The selected resource will be associated to this account as it’s default data placement for each new bucket that will be created via an S3 application';
const systemOwnerS3AccessTooltip = 'S3 access cannot be disabled for system owner';
const allowBucketCreationTooltip = 'The ability to create new buckets. By disabling this option, the user could not create any new buckets via S3 client or via the management console';

function mapResourceToOption({ type, name: value, storage }) {
    const { total, free: availableFree, unavailableFree } = storage;
    const free = sumSize(availableFree, unavailableFree);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const icons = type ? getCloudServiceMeta(type) : { icon: 'nodes-pool' };
    return { ...icons, value, remark };
}

class EditAccountS3AccessModalViewModel extends Observer {
    formName = this.constructor.name;
    s3PlacementToolTip = s3PlacementToolTip;
    allowBucketCreationTooltip = allowBucketCreationTooltip;
    isBucketSelectionDisabled = ko.observable();
    isS3AccessToggleDisabled = ko.observable();
    s3AccessToggleTooltip = ko.observable();
    resourceOptions = ko.observable();
    bucketOptions = ko.observable();
    isFormInitialized = ko.observable(false);
    form = null;

    constructor({ accountName }) {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    ['accounts', accountName],
                    'hostPools',
                    'cloudResources',
                    'buckets',
                    'namespaceBuckets'
                )
            ),
            this.onState
        );
    }

    onState([ account, hostPools, cloudResources, buckets, namespaceBuckets ]) {
        if (!account) {
            this.isFormInitialized(false);
            return;
        }

        const resourceOptions = flatMap(
            [ hostPools, cloudResources ],
            resources => Object.values(resources).map(mapResourceToOption)
        );

        const allBuckets = [
            ...Object.keys(buckets),
            ...Object.keys(namespaceBuckets)
        ];

        const bucketOptions = allBuckets
            .map(bucket => {
                const value = bucket;
                const tooltip =  { text: bucket, breakWords: true };
                return { value, tooltip };
            });

        this.isS3AccessToggleDisabled(account.isOwner);
        this.s3AccessToggleTooltip(account.isOwner ? systemOwnerS3AccessTooltip : '');
        this.resourceOptions(resourceOptions);
        this.bucketOptions(bucketOptions);

        if (!this.form) {
            this.form = new FormViewModel({
                name: this.formName,
                fields: {
                    accountName: account.name,
                    hasS3Access: account.hasS3Access,
                    hasAccessToAllBuckets: account.hasAccessToAllBuckets,
                    allowedBuckets: account.allowedBuckets || [],
                    defaultResource: account.defaultResource,
                    allowBucketCreation: account.canCreateBuckets
                },
                onForm: this.onForm.bind(this),
                onValidate: this.onValidate,
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitialized(true);

        }
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
        const allowedBuckets = this.bucketOptions()
            .map(opt => opt.value);

        this.form.allowedBuckets(allowedBuckets);
    }

    onClearSelectedBuckets() {
        this.form.allowedBuckets([]);
    }

    onSubmit({
        accountName,
        hasS3Access,
        defaultResource,
        hasAccessToAllBuckets,
        allowedBuckets,
        allowBucketCreation
    }) {

        action$.next(updateAccountS3Access(
            accountName,
            hasS3Access,
            defaultResource,
            hasAccessToAllBuckets,
            allowedBuckets,
            allowBucketCreation
        ));

        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
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
