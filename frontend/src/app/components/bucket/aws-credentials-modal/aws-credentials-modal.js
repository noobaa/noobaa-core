import template from './aws-credentials-modal.html';
import ko from 'knockout';
import { S3Connections, isS3ConnectionValid } from 'model';
import { checkS3Connection, addS3Connection } from 'actions';

class AWSCredentialsModalViewModel {
    constructor({ onClose }) {
        isS3ConnectionValid(true);
        this.onClose = onClose;

        let existingNames = S3Connections.map(
            ({ name }) => name
        );

        this.name = ko.observableWithDefault(
            () => {
                let highest = existingNames()
                    .map(
                        name => {
                            let match = name.match(/^Connection (\d+)$/);
                            return match ? parseInt(match[1]) : 0;
                        }
                    )
                    .reduce(
                        (a, b) => a > b ? a : b,
                        0
                    );

                return `Connection ${highest + 1}`;
            }
        )
        .extend({
            required: { message: 'Please enter valid connection name' },
            notIn: {
                params: { list: existingNames },
                message: 'Name already in use'
            }
        });

        this.endpoint = ko.observable('https://s3.amazonaws.com')
            .extend({
                required: { message: 'Please enter valid URI endpoint' },
                isURI: true
            });

        this.accessKey = ko.observable()
            .extend({
                required: { message: 'Please enter an aws access key' },
                notIn: {
                    params: {
                        list: S3Connections.map(
                            ({ access_key }) => access_key
                        )
                    },
                    message: 'Access Key already defined'
                }
            });

        this.secretKey = ko.observable()
            .extend({
                required: { message: 'Please enter an aws secret key'}
            });

        this.isValidConenction = isS3ConnectionValid
            .extend({
                equal: {
                    params: true,
                    message: 'Invlalid endpoint or credentials'
                }
            });

        this.checkSub = isS3ConnectionValid
            .subscribe(
                isValid => isValid && this.save()
            );

        this.errors = ko.validation.group([
            this.name,
            this.endpoint,
            this.accessKey,
            this.secretKey
        ]);
    }

    tryConnection() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            checkS3Connection(this.endpoint(), this.accessKey(), this.secretKey());
        }
    }

    save() {
        addS3Connection(this.name(), this.endpoint(), this.accessKey(), this.secretKey());
        this.onClose(false);
    }

    cancel() {
        isS3ConnectionValid(false);
        this.onClose(true);
    }

    dispose() {
        this.checkSub.dispose();
    }
}

export default {
    viewModel: AWSCredentialsModalViewModel,
    template: template
};
