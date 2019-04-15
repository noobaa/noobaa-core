/* Copyright (C) 2016 NooBaa */

import template from './edit-account-s3-access-modal.html';
import ConnectableViewModel from 'components/connectable';
import { flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getFormValues } from 'utils/form-utils';
import ko from 'knockout';
import {
    updateForm,
    updateAccountS3Access,
    closeModal
} from 'action-creators';

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

class EditAccountS3AccessModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    s3PlacementToolTip = s3PlacementToolTip;
    allowBucketCreationTooltip = allowBucketCreationTooltip;
    isS3AccessToggleDisabled = ko.observable();
    s3AccessToggleTooltip = ko.observable();
    isAllowAccessToFutureBucketsDisabled = ko.observable();
    resourceOptions = ko.observable();
    systemHasResources = false;
    bucketOptions = ko.observable();
    fields = ko.observable();

    selectState(state, params) {
        const {
            accounts,
            hostPools,
            cloudResources,
            buckets,
            namespaceBuckets,
            forms
        } = state;

        return [
            accounts && accounts[params.accountName],
            hostPools,
            cloudResources,
            buckets,
            namespaceBuckets,
            forms[this.formName]
        ];
    }

    mapStateToProps(
        account,
        hostPools,
        cloudResources,
        buckets,
        namespaceBuckets,
        form
    ) {
        if (!account || !hostPools || !cloudResources || !buckets || !namespaceBuckets) {
            return;
        }

        const resourceOptions = flatMap(
            [ hostPools, cloudResources ],
            resources => Object.values(resources).map(mapResourceToOption)
        );
        const systemHasResources= resourceOptions.length > 0;

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

        const {
            hasS3Access = account.hasS3Access,
            allowedBuckets = account.allowedBuckets
        } = form ? getFormValues(form) : {};

        const isAllowAccessToFutureBucketsDisabled =
            !hasS3Access ||
            allowedBuckets.length < bucketOptions.length;

        const defaultResource = account.defaultResource !== 'INTERNAL_STORAGE' ?
            account.defaultResource :
            undefined;

        ko.assignToProps(this, {
            isS3AccessToggleDisabled: account.isOwner,
            s3AccessToggleTooltip: account.isOwner ? systemOwnerS3AccessTooltip : '',
            resourceOptions: resourceOptions,
            systemHasResources,
            bucketOptions: bucketOptions,
            isAllowAccessToFutureBucketsDisabled,
            fields: !form ? {
                accountName: account.name,
                hasS3Access: account.hasS3Access,
                allowAccessToFutureBuckets: account.hasAccessToAllBuckets,
                allowedBuckets: account.allowedBuckets || [],
                defaultResource,
                allowBucketCreation: account.canCreateBuckets
            } : undefined
        });
    }

    onSelectAllowedBuckets(allowedBuckets) {
        const update = { allowedBuckets };
        if (allowedBuckets.length < this.bucketOptions().length) {
            update.allowAccessToFutureBuckets = false;
        }
        this.dispatch(updateForm(this.formName, update));
    }

    onWarn(values) {
        const warnings = {};
        const { hasS3Access } = values;

        if (hasS3Access && !this.systemHasResources) {
            warnings.defaultResource = 'Until connecting resources, internal storage will be used';
        }

        return warnings;
    }

    onValidate(values) {
        const errors = {};
        const { hasS3Access, defaultResource } = values;

        if (hasS3Access && this.systemHasResources && !defaultResource) {
            errors.defaultResource = 'Please select a default resource for the account';
        }

        return errors;
    }

    onSelectAllBuckets() {
        const allowedBuckets = this.bucketOptions()
            .map(opt => opt.value);

        this.dispatch(updateForm(this.formName, { allowedBuckets }));
    }

    onClearSelectedBuckets() {
        this.dispatch(updateForm(this.formName, { allowedBuckets: [] }));
    }

    onSubmit({
        accountName,
        hasS3Access,
        defaultResource,
        allowAccessToFutureBuckets,
        allowedBuckets,
        allowBucketCreation
    }) {

        this.dispatch(
            closeModal(),
            updateAccountS3Access(
                accountName,
                hasS3Access,
                defaultResource,
                allowAccessToFutureBuckets,
                allowedBuckets,
                allowBucketCreation
            )
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditAccountS3AccessModalViewModel,
    template: template
};
