import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deleteAccount } from 'actions';

export default class AccountRowViewModel extends BaseViewModel {
    constructor(account) {
        super();

        let systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );

        this.isVisible = ko.pureComputed(
            () => account()
        );

        this.username = ko.pureComputed(
            () => account() && account().email
        );

        let isSystemOwner = ko.pureComputed(
            () => systemInfo() && this.username() === systemInfo().owner.email
        );

        this.roles = ko.pureComputed(
            () => {
                if (!account() || !systemName()) {
                    return '';
                }

                return  isSystemOwner() ? 'owner' : account().systems.find(
                    ({ name }) => name === systemName()
                ).roles[0];
            }
        );

        this.hasS3Access = ko.pureComputed(
            () => !!account() && account().has_s3_access
        );

        this.isDeletable = ko.pureComputed(
            () =>  !isSystemOwner()
        );

        this.deleteToolTip = ko.pureComputed(
            () =>  this.isDeletable() ? 'delete user' : 'Cannot delete system owner'
        );
    }

    del() {
        deleteAccount(this.username());
    }
}
