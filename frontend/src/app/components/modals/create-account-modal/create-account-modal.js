/* Copyright (C) 2016 NooBaa */

import template from './create-account-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { randomString } from 'utils/string-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getFormValues, getFieldValue, isFieldTouched, isFieldValid, isFormValid } from 'utils/form-utils';
import { isEmail } from 'validations';
import {
    touchForm,
    closeModal,
    lockModal,
    createAccount
} from 'action-creators';

const s3PlacementToolTip = 'The selected resource will be associated to this account as it’s default data placement for each new bucket that will be created via an S3 application';
const allowBucketCreationTooltip = 'The ability to create new buckets. By disabling this option, the user could not create any new buckets via S3 client or via the management console';

function mapResourceToOptions({ type, name: value, storage }) {
    const { total, free: availableFree, unavailableFree } = storage;
    const free = sumSize(availableFree, unavailableFree);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const icons = type ? getCloudServiceMeta(type) : { icon: 'nodes-pool' };
    return { ...icons, value, remark };
}

const steps = deepFreeze([
    'Account Details',
    'S3 Access'
]);

const fieldsByStep = deepFreeze({
    0: [ 'accountName' ],
    1: [ 'defaultResource' ]
});

function _getAccountNameFieldProps(form) {
    if (!form) return {};

    const hasLoginAccess = getFieldValue(form, 'hasLoginAccess');
    if (hasLoginAccess) {
        return {
            label: 'Email Address',
            placeholder: 'Enter account email address',
            isRemarkVisible: false
        };

    } else {
        const touched = isFieldTouched(form, 'accountName');
        const valid = isFieldValid(form, 'accountName');

        return {
            label: 'Account Name',
            placeholder: 'Name this account',
            isRemarkVisible: !touched || valid
        };
    }
}

class CreateAccountModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    steps = steps;
    s3PlacementToolTip = s3PlacementToolTip;
    allowBucketCreationTooltip = allowBucketCreationTooltip;
    accountNames = null;
    systemHasResources = null;
    resourceOptions = ko.observable();
    bucketOptions = ko.observable();
    password = randomString();
    accountNameProps = {
        label: ko.observable(),
        placeholder: ko.observable(),
        isRemarkVisible: ko.observable()
    };
    isS3AccessDisabled = ko.observable();
    isBucketSelectionDisabled = ko.observable();
    isStepValid = false;
    fields = ko.observable();

    selectState(state) {
        return [
            state.accounts,
            state.hostPools,
            state.cloudResources,
            state.buckets,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(accounts, hostPools, cloudResources, buckets, form) {
        if (!accounts || !hostPools || !cloudResources || !buckets) {
            ko.assignToProps(this, {
                accountNameProps: {}
            });

        } else {
            const {
                hasS3Access = true,
                hasAccessToAllBuckets = false
            } = form ? getFormValues(form) : {};

            const accountNames = Object.keys(accounts);
            const resourceList = [
                ...Object.values(hostPools),
                ...Object.values(cloudResources)
            ];
            const resourceOptions = resourceList.map(mapResourceToOptions);
            const systemHasResources = resourceList.length > 0;
            const bucketOptions = Object.keys(buckets);
            const isS3AccessDisabled = (form && form.submitted) || !hasS3Access;
            const isBucketSelectionDisabled = isS3AccessDisabled || hasAccessToAllBuckets;

            ko.assignToProps(this, {
                accountNames,
                resourceOptions,
                bucketOptions,
                accountNameProps: _getAccountNameFieldProps(form),
                isS3AccessDisabled,
                isBucketSelectionDisabled,
                systemHasResources,
                isStepValid: form ? isFormValid(form) : false,
                fields: !form ? {
                    step: 0,
                    accountName: '',
                    hasLoginAccess: true,
                    hasS3Access,
                    defaultResource: undefined,
                    hasAccessToAllBuckets,
                    allowedBuckets: Object.keys(buckets),
                    allowBucketCreation: true
                } : undefined
            });
        }


    }
    onWarn(values) {
        const warnings = {};
        const { hasS3Access, step } = values;

        // console.warn(values, this.systemHasResources);
        if (step === 1) {
            if (hasS3Access && !this.systemHasResources) {
                warnings.defaultResource = 'Until connecting resources, internal storage will be used';
            }
        }

        return warnings;
    }

    onValidate(values) {
        const {
            step,
            accountName,
            hasLoginAccess,
            hasS3Access,
            defaultResource
        } = values;

        const subject = hasLoginAccess ? 'Email address' : 'Account name';
        const accounts = this.accountNames;
        const errors = {};
        const trimmedName = accountName.trim();

        if (step == 0) {
            if (!trimmedName) {
                errors.accountName = `${subject} is required`;
            } else if (hasLoginAccess && !isEmail(trimmedName)) {
                errors.accountName = 'Please enter a valid email address';

            } else if (hasLoginAccess && trimmedName.length > 70) {
                errors.accountName = 'Please enter an email address up to 70 characters';

            } else if (!hasLoginAccess && (trimmedName.length < 3 || trimmedName.length > 32)) {
                errors.accountName = 'Please enter a name between 3 - 32 characters';

            } else if (accounts.includes(trimmedName)) {
                errors.accountName = `${subject} already in use by another account`;
            }

        } else if (step === 1) {
            if (!hasLoginAccess && !hasS3Access) {
                errors.hasS3Access = 'A user must have either login access or s3 access';
            }

            if (hasS3Access && this.systemHasResources && !defaultResource) {
                errors.defaultResource = 'Please select a default resource for the account';
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onAfterStep(step) {
        if (step === 1 && !this.systemHasResources) {
            this.dispatch(touchForm(this.formName, ['defaultResource']));
        }
    }

    onSubmit(values) {
        this.dispatch(
            lockModal(),
            createAccount(
                values.accountName.trim(),
                values.hasLoginAccess,
                this.password,
                values.hasS3Access,
                values.defaultResource,
                values.hasAccessToAllBuckets,
                values.allowedBuckets,
                values.allowBucketCreation
            )
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: CreateAccountModalViewModel,
    template: template
};
