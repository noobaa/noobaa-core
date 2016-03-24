import template from './aws-credentials-modal.html';
import ko from 'knockout';
import { awsCredentialsList } from 'model';
import { addAWSCredentials } from 'actions';

class AWSCredentialsModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;
        this.endPoint = ko.observable('https://s3.amazonaws.com')
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

        this.errors = ko.validation.group({
            accessKey: this.accessKey,
            secretKey: this.secretKey
        });
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            addAWSCredentials(this.accessKey(), this.secretKey(),this.endPoint());
            this.onClose(false);
        }
    }

    cancel() {
        this.onClose(true);
    }
}

export default {
    viewModel: AWSCredentialsModalViewModel,
    template: template
}
