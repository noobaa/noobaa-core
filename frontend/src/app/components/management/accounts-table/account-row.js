import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deleteAccount } from 'actions';

export default class AccountRowViewModel extends Disposable {
    constructor(account, table) {
        super();

        let systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );


        this.email = ko.pureComputed(
            () => account() && account().email
        );

        let isSystemOwner = ko.pureComputed(
            () => systemInfo() && this.email() === systemInfo().owner.email
        );

        this.role = ko.pureComputed(
            () => {
                if (!account() || !systemName()) {
                    return '';
                }

                return  isSystemOwner() ? 'owner' : account().systems.find(
                    ({ name }) => name === systemName()
                ).roles[0];
            }
        );

        this.s3Access = ko.pureComputed(
            () => {
                if (!account()) {
                    return {};
                }

                return {
                    text: account().has_s3_access ? 'enabled' : 'disabled',
                    edit: () => table.openS3AccessModal(this.email())
                };
            }
        );

        this.password = () => table.openResetPasswordModal(this.email());

        this.deleteButton = {
            subject: 'account',
            group: table.deleteGroup,
            undeletable: isSystemOwner,
            deleteTooltip: ko.pureComputed(
                () => this.isSystemOwner() ?
                    'Cannot delete system owner' :
                    'Delete account'
            ),
            onDelete: () => deleteAccount(this.email())
        };
    }
}
