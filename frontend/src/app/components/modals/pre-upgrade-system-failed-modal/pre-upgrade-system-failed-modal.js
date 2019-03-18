import template from './pre-upgrade-system-failed-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal } from 'action-creators';
import { deepFreeze, get } from 'utils/core-utils';
import { formatEmailUri } from 'utils/browser-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { support } from 'config';

const columns = deepFreeze([
    {
        name: 'icon',
        label: '',
        type: 'icon'
    },
    {
        name: 'server',
        label: 'Server Name'
    },
    {
        name: 'details',
        type: 'issueDetails'
    }
]);

class IssueRowViewModel {
    icon = {
        name: 'problem',
        css: 'error',
        tooltip: 'Failure'
    };
    server = ko.observable();
    details = ko.observable();

    onState(issue, server) {
        const { message, reportInfo }= issue;
        this.server(getServerDisplayName(server));
        this.details({
            message : message,
            reportHref: reportInfo && formatEmailUri(support.email, reportInfo)
        });

    }
}

class PreUpgradeSystemFailedModalViewModel extends ConnectableViewModel {
    columns = columns;
    supportEmail = formatEmailUri(support.email, support.upgradeFailedSubject);
    rows = ko.observableArray()
        .ofType(IssueRowViewModel);

    selectState(state) {
        return [
            state.topology.servers
        ];
    }

    mapStateToProps(servers) {
        if (servers) {
            const issues = Object.values(servers).reduce((issues, server) => {
                const error = get(server, ['upgrade', 'package', 'error']);
                if (error) {
                    issues.push({
                        server: server.secret,
                        ...error
                    });
                }
                return issues;
            },[]);

            ko.assignToProps(this, {
                rows: issues.map(issue => {
                    const { message, reportInfo } = issue;
                    const reportHref = reportInfo && formatEmailUri(support.email, reportInfo);
                    return { message, reportHref };
                })
            });
        }
    }

    onClose() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: PreUpgradeSystemFailedModalViewModel,
    template: template
};
