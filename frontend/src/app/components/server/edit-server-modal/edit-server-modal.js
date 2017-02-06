import template from './edit-server-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateServerDetails } from 'actions';

class EditServerModalViewModel extends BaseViewModel {
    constructor({ serverSecret, onClose }) {
        super();

        const server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                ({ secret }) => secret === ko.unwrap(serverSecret)
            )
        );

        this.secret = serverSecret;

        this.hostname = ko.observableWithDefault(
            () => server() && server().hostname
        )
            .extend({
                required: { message: 'Please enter a valid hostname' },
                isHostname: true
            });

        this.locationTag = ko.observableWithDefault(
            () => server() && server().location
        );


        this.onClose = onClose;
        this.errors = ko.validation.group(this);
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateServerDetails(
                ko.unwrap(this.secret),
                this.hostname(),
                this.locationTag()
            );

            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditServerModalViewModel,
    template: template
};
