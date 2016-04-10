import template from './aws-credentials-modal.html';
import ko from 'knockout';
import { awsCredentialsList, areAwsCredentialValid } from 'model';
import { checkAWSCredentials, addAWSCredentials } from 'actions';

class AWSCredentialsModalViewModel {
    constructor({ onClose }) {
        areAwsCredentialValid(true);
        this.onClose = onClose;

        let existingNames = awsCredentialsList.map(
            ({ name, access_key }) => name || access_key
        );

        this.name = ko.observableWithDefault(
            () => {
                let highest = existingNames()
                    .map(
                        name => {
                            let match = name.match(/^Connection (\d+)$/);
                            return match ? parseInt(match[1]) : 0
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
                        list: awsCredentialsList.map(
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

        this.isValidConenction = areAwsCredentialValid
            .extend({ 
                equal: { 
                    params: true,
                    message: 'Invlalid endpoint or credentials' 
                }
            })

        this.checkSub = areAwsCredentialValid
            .subscribe(
                () => this.save()
            );

        this.errors = ko.validation.group({
            name: this.name,
            endpoint: this.endpoint,
            accessKey: this.accessKey,
            secretKey: this.secretKey,
        });
    }

    tryConnection() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            checkAWSCredentials(this.endpoint(), this.accessKey(), this.secretKey());
        }
    }

    save() {
        if (this.isValidConenction()) {
            addAWSCredentials(this.name(), this.endpoint(), this.accessKey(), this.secretKey());
            this.onClose(false);
        }
    }

    cancel() {
        areAwsCredentialValid(false);
        this.onClose(true);
    }

    dispose() {
        this.checkSub.dispose();
    }
}

export default {
    viewModel: AWSCredentialsModalViewModel,
    template: template
}
