/* Copyright (C) 2016 NooBaa */

import template from './edit-account-s3-access-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { getCloudResourceTypeIcon } from 'utils/resource-utils';
import { getFieldValue } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import {
    updateForm,
    updateAccountS3Access,
    closeModal
} from 'action-creators';

const s3PlacementToolTip = 'The selected resource will be associated to this account as it’s default data placement for each new bucket that will be created via an S3 application';
const systemOwnerS3AccessTooltip = 'S3 access cannot be disabled for system owner';
const allowBucketCreationTooltip = 'The ability to create new buckets. By disabling this option, the user could not create any new buckets via S3 client or via the management console';

function mapResourceToOption(resource) {
    const { type, name: value, storage } = resource;
    const { total, free: availableFree, unavailableFree } = storage;
    const free = sumSize(availableFree, unavailableFree);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const icons = { icon: type ? getCloudResourceTypeIcon(resource).name : 'nodes-pool' };
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
    fields = ko.observable();

    constructor({ accountName }) {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    ['accounts', accountName],
                    'hostPools',
                    'cloudResources',
                    'buckets',
                    'namespaceBuckets',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([
        account,
        hostPools,
        cloudResources,
        buckets,
        namespaceBuckets,
        form
    ]) {
        if (!account || !hostPools || !cloudResources || !buckets || !namespaceBuckets) {
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

        const isBucketSelectionDisabled = form ?
            (!getFieldValue(form, 'hasS3Access') || getFieldValue(form, 'hasAccessToAllBuckets')) :
            true;

        this.isS3AccessToggleDisabled(account.isOwner);
        this.s3AccessToggleTooltip(account.isOwner ? systemOwnerS3AccessTooltip : '');
        this.resourceOptions(resourceOptions);
        this.bucketOptions(bucketOptions);
        this.isBucketSelectionDisabled(isBucketSelectionDisabled);

        if (!this.fields()) {
            this.fields({
                accountName: account.name,
                hasS3Access: account.hasS3Access,
                hasAccessToAllBuckets: account.hasAccessToAllBuckets,
                allowedBuckets: account.allowedBuckets || [],
                defaultResource: account.defaultResource,
                allowBucketCreation: account.canCreateBuckets
            });
        }
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

        action$.next(updateForm(this.formName, { allowedBuckets }));
    }

    onClearSelectedBuckets() {
        action$.next(updateForm(this.formName, { allowedBuckets: [] }));
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
}

export default {
    viewModel: EditAccountS3AccessModalViewModel,
    template: template
};
