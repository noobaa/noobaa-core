import template from './attach-server-modal.html';
import configureServerStepTemplate from './configure-server-step.html';
import editDetailsStepTemplate from './edit-details-step.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { verifyServer, attachServerToCluster } from 'actions';
import { support } from 'config';
import { deepFreeze } from 'utils/core-utils';
import { formatEmailUri } from 'utils/browser-utils';
import { systemInfo, serverVerificationState } from 'model';
import { inputThrottle } from 'config';

const steps = deepFreeze([
    'Configure Server',
    'Edit Details'
]);

class AttachServerModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.configureServerStepTemplate = configureServerStepTemplate;
        this.editDetailsStepTemplate = editDetailsStepTemplate;
        this.steps = steps;

        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );

        this.address = ko.observable()
            .extend({
                rateLimit: {
                    timeout: inputThrottle,
                    method: 'notifyWhenChangesStop'
                }
            })
            .extend({
                required: { message: 'Please enter a valid IP address' },
                isIP: true,
                validation: [
                    {
                        validator: newAddress => {
                            const { address, result } = serverVerificationState() || {};
                            return newAddress !== address || result !== 'ADDING_SELF';
                        },
                        message: 'Server is already a member of this cluster'
                    },
                    {
                        validator: newAddress => {
                            const { address, result } = serverVerificationState() || {};
                            return newAddress !== address || result !== 'UNREACHABLE';
                        },
                        message: 'Server is unreachable'
                    },
                    {
                        validator: newAddress => {
                            const { address, result } = serverVerificationState() || {};
                            return newAddress !== address || result !== 'VERSION_MISMATCH';
                        },
                        message: 'Server version in not up to date'
                    },
                    {
                        validator: newAddress => {
                            const { address, result } = serverVerificationState() || {};
                            return newAddress !== address || result !== 'ALREADY_A_MEMBER';
                        },
                        message: 'Server is already a member of a cluster'
                    },
                    {
                        validator: newAddress => {
                            const { address, result } = serverVerificationState() || {};
                            return newAddress !== address || result !== 'HAS_OBJECTS';
                        },
                        message: 'Server hold uploaded files'
                    }
                ]
            });

        this.secret = ko.observable()
            .extend({
                rateLimit: {
                    timeout: inputThrottle,
                    method: 'notifyWhenChangesStop'
                }
            })
            .extend({
                required: { message: 'Please enter the server secret' },
                exactLength: {
                    params: 8,
                    message: 'Secret is exactly {0} characters long'
                },
                validation: {
                    validator: newSecret => {
                        const { secret, result } = serverVerificationState() || {};
                        return newSecret !== secret || result !== 'SECRET_MISMATCH';
                    },
                    message: 'Secret does not match server'
                }
            });

        this.asyncValidation = ko.observable().extend({
            validation: {
                async: true,
                onlyIf: () => this.address.isValid() && this.secret.isValid(),
                validator: (_, __, callback) => {
                    verifyServer(this.address(), this.secret());

                    serverVerificationState.once(
                        ({ result }) => callback(result === 'OKAY')
                    );
                }
            }
        });

        this.hostname = ko.observableWithDefault(
            () => (serverVerificationState() || {}).hostname
        )
            .extend({
                required: { message: 'Server name is required' },
                isHostname: true
            });



        this.nameSuffix = ko.pureComputed(
            () => `- ${this.secret()}`
        );

        this.location = ko.observable('Earth')
            .extend({
                required: { message: 'Location tag is required' }
            });

        this.configureErrors = ko.validation.group([
            this.address,
            this.secret,
            this.asyncValidation
        ]);

        this.detailsErrors = ko.validation.group([
            this.hostname,
            this.location
        ]);

        this.contactSupportUri = formatEmailUri(
            support.email,
            support.missingOVAMailSubject
        );
    }

    validateStep(step) {
        switch (step) {
            case 1:
                if (this.asyncValidation.isValidating() ||
                    this.configureErrors().length > 0) {
                    this.configureErrors.showAllMessages();
                    return false;
                }
                break;

            case 2:
                if (this.detailsErrors().length > 0) {
                    this.detailsErrors.showAllMessages();
                    return false;
                }
                break;
        }

        return true;
    }

    attachServer() {
        attachServerToCluster(
            this.address(),
            this.secret(),
            this.hostname(),
            this.location()
        );
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
