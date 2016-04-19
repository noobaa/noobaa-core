import ko from 'knockout';
import { systemInfo } from 'model';
import { deleteAccount } from 'actions';

export default class AccountRowViewModel {
    constructor(account, deleteCandidate) {
        let systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );

        this.isVisible = ko.pureComputed(
            () => account()
        );

        this.user = ko.pureComputed(
            () => account() && account().email
        );

        let isSystemOwner = ko.pureComputed(
            () => this.user() === systemInfo().owner
        )

        this.roles = ko.pureComputed(
            () => {
                if (!account() || !systemName()) {
                    return '';
                }

                return  isSystemOwner() ?
                    'owner' :
                    account().systems.find( 
                        ({ name }) => name === systemName() 
                    ).roles[0]
            }
        );

        this.hasS3Access = ko.pureComputed(
            () => !!account() && account().has_allowed_buckets
        );

        this.isDeletable = ko.pureComputed(
            () =>  !isSystemOwner()
        );

        this.deleteToolTip = ko.pureComputed(
            () =>  this.isDeletable() ? 'delete user' : 'Cannot detete system owner'
        );
    }

    del() {
        deleteAccount(this.user())
    }
}