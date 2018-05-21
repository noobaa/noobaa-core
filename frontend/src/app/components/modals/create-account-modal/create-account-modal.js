/* Copyright (C) 2016 NooBaa */

import template from './create-account-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { randomString } from 'utils/string-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { getMany } from 'rx-extensions';
import { getFormValues, getFieldValue, isFieldTouched, isFieldValid } from 'utils/form-utils';
import { isEmail } from 'validations';
import { closeModal, lockModal, createAccount } from 'action-creators';

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

class CreateAccountWizardViewModel extends Observer {
    formName = this.constructor.name;
    steps = steps;
    s3PlacementToolTip = s3PlacementToolTip;
    allowBucketCreationTooltip = allowBucketCreationTooltip;
    accountNames = null;
    resourceOptions = ko.observable();
    bucketOptions = ko.observable();
    password = randomString();
    accountNameProps = ko.observable();
    isS3AccessDisabled = ko.observable();
    isBucketSelectionDisabled = ko.observable();
    form = null;
    isFormInitialized = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    'hostPools',
                    'cloudResources',
                    'buckets',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([accounts, hostPools, cloudResources, buckets, form]) {
        if (!accounts || !hostPools || !cloudResources || !buckets) {
            this.accountNameProps({});
            this.isFormInitialized(false);
            return;
        }

        const {
            hasS3Access = true,
            hasAccessToAllBuckets = false
        } = form ? getFormValues(form) : {};

        const accountNames = Object.keys(accounts);
        const resourceOptions = flatMap(
            [ hostPools, cloudResources ],
            resources => Object.values(resources).map(mapResourceToOptions)
        );
        const bucketOptions = Object.keys(buckets);
        const isS3AccessDisabled = (form && form.submitted) || !hasS3Access;
        const isBucketSelectionDisabled = isS3AccessDisabled || hasAccessToAllBuckets;

        this.accountNames = accountNames;
        this.resourceOptions(resourceOptions);
        this.bucketOptions(bucketOptions);
        this.accountNameProps(_getAccountNameFieldProps(form));
        this.isS3AccessDisabled(isS3AccessDisabled);
        this.isBucketSelectionDisabled(isBucketSelectionDisabled);

        if (!form) {
            this.accountNameProps({});
            this.form = new FormViewModel({
                name: this.formName,
                fields: {
                    step: 0,
                    accountName: '',
                    hasLoginAccess: true,
                    hasS3Access: hasS3Access,
                    defaultResource: undefined,
                    hasAccessToAllBuckets: hasAccessToAllBuckets,
                    allowedBuckets: Object.keys(buckets),
                    allowBucketCreation: true
                },
                groups: {
                    0: [ 'accountName' ],
                    1: [ 'defaultResource' ]
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitialized(true);
        }

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

            if (hasS3Access && !defaultResource) {
                errors.defaultResource = 'Please select a default resource for the account';
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        const { form } = this;
        if (!form.isValid()) {
            form.touch(step);
            return false;
        }

        return true;
    }

    onSelectAllBuckets() {
        const allowedBuckets = this.bucketOptions();
        this.form.allowedBuckets(allowedBuckets);
    }

    onClearSelectedBuckets() {
        this.form.allowedBuckets([]);
    }

    onSubmit(values) {
        action$.next(createAccount(
            values.accountName.trim(),
            values.hasLoginAccess,
            this.password,
            values.hasS3Access,
            values.defaultResource,
            values.hasAccessToAllBuckets,
            values.allowedBuckets,
            values.allowBucketCreation
        ));

        action$.next(lockModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: CreateAccountWizardViewModel,
    template: template
};
