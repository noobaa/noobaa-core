import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { sessionInfo, systemInfo } from 'model';
import { stringifyAmount } from 'utils/string-utils';

export default class AccountRowViewModel extends BaseViewModel {
    constructor(account, table) {
        super();

        let systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );

        this.email = ko.pureComputed(
            () => account() ? account().email : ''
        );

        this.name = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const email = this.email();
                const curr = sessionInfo() && sessionInfo().user;
                const text = `${email} ${email === curr ? '(Current user)' : ''}`;
                const href = {
                    route: 'account',
                    params: { account: email, tab: null }
                };

                return { text, href };
            }
        );

        this.connections = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const count = account().external_connections.count;
                return count > 0 ?
                    stringifyAmount('connection', count) :
                    'no connections';
            }
        );


        const isSystemOwner = ko.pureComputed(
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
            tooltip: ko.pureComputed(
                () => isSystemOwner() ? 'Cannot delete system owner' : 'Delete account'
            ),
            onDelete: () => table.deleteAccount(this.email())
        };
    }
}
