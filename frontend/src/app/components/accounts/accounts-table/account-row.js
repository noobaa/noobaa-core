/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

export default class AccountRowViewModel {
    constructor({ baseRoute, onSelectForDelete, onDelete }) {
        this.baseRoute = baseRoute;
        this.name = ko.observable();
        this.role = ko.observable();
        this.isSystemOwner = ko.observable();
        this.s3Access = ko.observable();
        this.loginAccess = ko.observable();
        this.defaultResource = ko.observable();
        this.isCurrentUser = false;

        this.deleteButton = {
            id: ko.observable(),
            text: 'Delete Account',
            active: ko.observable(),
            disabled: this.isSystemOwner,
            tooltip: ko.observable(),
            onToggle: onSelectForDelete,
            onDelete: email => onDelete(email, this.isCurrentUser)
        };
    }

    onAccount(account, role, currentUser, selectedForDelete) {
        const { name, isOwner, hasS3Access, hasLoginAccess, defaultResource } = account;
        const defaultResourceInfo = {
            text: defaultResource || '(not set)',
            tooltip: defaultResource && {
                text: defaultResource,
                breakWords: true
            }
        };

        const accountNameText = `${name} ${currentUser === name ? '(Current user)' : ''}`;
        const nameInfo = {
            text: accountNameText,
            href: realizeUri(this.baseRoute, { account: name }),
            tooltip: accountNameText
        };

        this.isCurrentUser = currentUser === name;
        this.name(nameInfo);
        this.role(role);
        this.isSystemOwner(isOwner);
        this.s3Access(hasS3Access ? 'enabled' : 'disabled');
        this.loginAccess(hasLoginAccess ? 'enabled' : 'disabled');
        this.defaultResource(defaultResourceInfo);
        this.deleteButton.id(name);
        this.deleteButton.active(selectedForDelete === name);
        this.deleteButton.tooltip(isOwner ? 'Cannot delete system owner' : 'Delete account');
    }
}
