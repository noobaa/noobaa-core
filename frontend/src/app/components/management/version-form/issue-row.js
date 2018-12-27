// Copyright (C) 2016 NooBaa

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

const issueIcon = deepFreeze();

export default class IssueRowViewModel {
    constructor() {
        this.icon = issueIcon;
        this.server = ko.observable();
        this.details = ko.observable();
    }

    onState(issue, server) {
        const { message, reportInfo }= issue;
        this.server(getServerDisplayName(server));
        this.details({
            message : message,
            reportHref: reportInfo && formatEmailUri(support.email, reportInfo)
        });
    }
}
