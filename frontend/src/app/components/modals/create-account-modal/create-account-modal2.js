import template from './create-account-modal2.html';
import FromViewModel from 'components/form-view-model';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { randomString } from 'utils/string-utils';
import state$ from 'state';
import { isEmail } from 'validations';
import { createAccount, lockActiveModal } from 'dispatchers';
import ko from 'knockout';

const storageTypes = deepFreeze({
    AWS: {
        icon: 'aws-s3-resource-dark',
        selectedIcon: 'aws-s3-resource-colored'
    },
    AZURE: {
        icon: 'azure-resource-dark',
        selectedIcon: 'azure-resource-colored'
    },
    S3_COMPATIBLE: {
        icon: 'cloud-resource-dark',
        selectedIcon: 'cloud-resource-colored'
    },
    NODES_POOL: {
        icon: 'nodes-pool'
    }
});

class CreateAccountWizardViewModel extends FromViewModel {
    constructor({ onClose }) {
        super('createAccount');

        this.onClose = onClose;

        // Projected state.
        this.resources = ko.observable();
        this.buckets = ko.observable();
        this.accounts = undefined;

        // Used to lock the ui.
        this.lock = ko.observable();

        // Initalize the form
        this.initialize({
            email: '',
            enableS3Access: false,
            selectedBuckets: [],
            selectedResource: undefined
        });

        // Observe state.
        this.observe(state$.get('buckets'), this.onBuckets);
        this.observe(state$.get('accounts'), this.onAccounts);
        this.observe(state$.getMany('nodePools', 'cloudResources'), this.onResources);
    }

    onState(state) {
        super.onState(state);
        this.buckets(Object.keys(state.buckets));
    }

    onAccounts(accounts) {
        this.accounts = Object.keys(accounts);

        const account = accounts[this.email()];
        if (account) {
            if (account.mode === 'IN_CREATION') {
                lockActiveModal();
                this.lock(true);
            } else {
                this.onClose();
                // this.replaceModal();
            }
        }
    }

    onBuckets(buckets) {
        this.buckets(Object.keys(buckets));
    }

    onResources(resources) {
        this.resources = flatMap(
            resources,
            resourceGroup => Object.values(resourceGroup).map(
                ({ type = 'NODES_POOL', name: value, storage }) => {
                    const { total, free: available_free, unavailable_free } = storage;
                    const free = sumSize(available_free, unavailable_free);
                    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
                    return { ...storageTypes[type], value, remark };
                }
            )
        );
    }

    validate({ email, enableS3Access, selectedResource }) {
        let errors = {};

        // Validate email address
        if (!email) {
            errors.email = 'Email address is required';

        } else if (!isEmail(email)) {
            errors.email = 'Please enter a valid email address';

        } else if (this.accounts.includes(email)) {
            errors.email = 'Email address already in use by another account';
        }

        // Validate selected resource
        if (enableS3Access && !selectedResource) {
            errors.selectedResource = 'Please select a default resource for the account';
        }

        return { errors };
    }

    onSelectAllBuckets() {
        this.update('selectedBuckets', this.buckets());
    }

    onClearAllBuckets() {
        this.update('selectedBuckets', []);
    }

    onCreate() {
        if (!this.valid()) {
            this.touchAll();
            return;
        }

        createAccount(
            this.email(),
            randomString(),
            this.enableS3Access(),
            this.selectedResource(),
            this.selectedBuckets()
        );
    }
}

export default {
    viewModel: CreateAccountWizardViewModel,
    template: template
};
