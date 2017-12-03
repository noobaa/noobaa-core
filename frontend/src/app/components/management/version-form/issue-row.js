// Copyright (C) 2016 NooBaa

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getServerDisplayName } from 'utils/cluster-utils';

const issueIcon = deepFreeze({
    name: 'problem',
    css: 'error'
});

export default class IssueRowViewModel {
    constructor() {
        this.icon = issueIcon;
        this.server = ko.observable();
        this.message = ko.observable();
    }

    onState(message, server) {
        this.server(getServerDisplayName(server));
        this.message(message);

    }
}
