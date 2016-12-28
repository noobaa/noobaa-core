import template from './attach-server-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { attachServerToCluster } from 'actions';
import { support } from 'config';
import { formatEmailUri } from 'utils/browser-utils';

class AttachServerModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        this.address = ko.observable()
            .extend({
                required: { message: 'Please enter a valid IP address or DNS name' },
                isIPOrDNSName: { message: 'Please enter a valid IP address or DNS name' }
            });

        this.secret = ko.observable()
            .extend({
                required: { message: 'Please enter the server secret' },
                minLength: {
                    params: 8,
                    message: 'Secret length must be exactly 8 characters'
                },
                maxLength: {
                    params: 8,
                    message: 'Secret length must be exactly 8 characters'
                }
            });

        this.hostname = ko.observable()
            .extend({
                isHostname: true
            });

        this.nameSuffix = ko.pureComputed(
            () => `${this.secret() || '<secret>'}`
        );

        this.location = ko.observable();

        this.errors = ko.validation.group(this);

        this.contactSupportUri = formatEmailUri(
            support.email,
            support.missingOVAMailSubject
        );
    }

    attach() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            attachServerToCluster(
                this.address(),
                this.secret(),
                this.hostname(),
                this.location()
            );
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
