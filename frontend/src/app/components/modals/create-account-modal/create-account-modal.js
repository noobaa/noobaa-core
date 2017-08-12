/* Copyright (C) 2016 NooBaa */

import template from './create-account-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { randomString } from 'utils/string-utils';
import { getCloudServiceMeta } from 'utils/ui-utils';
import { isEmail } from 'validations';
import { createAccount } from 'action-creators';

function mapResourceToOptions({ type, name: value, storage }) {
    const { total, free: available_free, unavailable_free } = storage;
    const free = sumSize(available_free, unavailable_free);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const icons = type ? getCloudServiceMeta(type) : { icon: 'nodes-pool' };
    return { ...icons, value, remark };
}

const steps = deepFreeze([
    'Account Details',
    'S3 Access'
]);

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

const formName = 'createAccount';

class CreateAccountWizardViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.steps = steps;
        this.bucketPermissionModes = bucketPermissionModes;
        this.accountNames = null;
        this.resourceOptions = ko.observable();
        this.bucketOptions = ko.observable();
        this.password = randomString();
        this.accountNameLabel = ko.observable();
        this.accountNamePlaceholder = ko.observable();
        this.isAccountNameRemarkVisible = ko.observable();
        this.isBucketSelectionDisabled = ko.observable();

        this.form = new FormViewModel({
            name: formName,
            fields: {
                step: 0,
                accountName: '',
                hasLoginAccess: true,
                hasS3Access: true,
                defaultResource: undefined,
                hasAccessToAllBuckets: false,
                allowedBuckets: [],
            },
            groups: {
                0: [ 'accountName' ],
                1: [ 'defaultResource' ]
            },
            onForm: this.onForm.bind(this),
            onValidate: this.onValidate.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

        this.observe(
            state$.getMany(
                'accounts',
                ['nodePools', 'pools'],
                ['cloudResources', 'resources'],
                'buckets'
            ),
            this.onState
        );
    }

    onState([accounts, nodePools, cloudResources, buckets]) {
        this.accountNames = Object.keys(accounts);

        this.resourceOptions(flatMap(
            [ nodePools, cloudResources ],
            resources => Object.values(resources).map(mapResourceToOptions)
        ));

        this.bucketOptions(Object.keys(buckets));
    }

    onForm(form) {
        if (!form) return;
        const {
            hasLoginAccess,
            accountName,
            hasS3Access,
            hasAccessToAllBuckets
        } = form.fields;

        if (hasLoginAccess.value) {
            this.accountNameLabel('Email Address');
            this.accountNamePlaceholder('Enter account email address');
            this.isAccountNameRemarkVisible(false);
        } else {
            this.accountNameLabel('Account Name');
            this.accountNamePlaceholder('Name this account');
            this.isAccountNameRemarkVisible(!accountName.touched || accountName.validity !== 'INVALID');
        }

        this.isBucketSelectionDisabled(
            form.locked ||
            !hasS3Access.value ||
            hasAccessToAllBuckets.value
        );
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
            }
            else if (hasLoginAccess && !isEmail(trimmedName)) {
                errors.accountName = 'Please enter a valid email address';

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
        this.form.allowedBuckets(this.bucketOptions());
    }

    onClearSelectedBuckets() {
        this.form.allowedBuckets([]);
    }

    async onSubmit(values) {
        action$.onNext(createAccount(
            values.accountName.trim(),
            values.hasLoginAccess,
            this.password,
            values.hasS3Access,
            values.defaultResource,
            values.hasAccessToAllBuckets,
            values.allowedBuckets
        ));
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
