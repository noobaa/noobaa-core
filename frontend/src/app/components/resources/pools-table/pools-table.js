import template from './pools-table.html';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { makeArray, compare } from 'utils';
import { redirectTo } from 'actions';
import { routeContext, systemInfo } from 'model';

const maxRows = 100;

const compareFuncs = Object.freeze({
    state: () => compare(true, true),
    name: (p1, p2) => compare(p1.name, p2.name),
    nodecount: (p1, p2) => compare(p1.nodes.count, p2.nodes.count),
    onlinecount: (p1, p2) => compare(p1.nodes.online, p2.nodes.online),
    offlinecount: (p1, p2) => compare(
        p1.nodes.count - p1.nodes.online,
        p2.nodes.count - p2.nodes.online
    ),
    usage: (p1, p2) => compare(p1.storage.used, p2.storage.used),
    capacity: (p1, p2) => compare(p1.storage.total, p2.storage.total)
});

class PoolsTableViewModel {
    constructor() {
        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sortedBy = ko.pureComputed(
            () => query().sortBy || 'name'
        );

        this.order = ko.pureComputed(
            () => Number(query().order) || 1
        );

        let pools = ko.pureComputed(
            () => systemInfo() && systemInfo().pools
                .filter(
                    pool => pool.nodes
                )
                .sort(
                    (b1, b2) => this.order() * compareFuncs[this.sortedBy()](b1, b2)
                )
        );

        let rows = makeArray(
            maxRows,
            i => new PoolRowViewModel(() => pools() && pools()[i])
        );

        this.visibleRows = ko.pureComputed(
            () => rows.filter(row => row.isVisible())
        );

        this.deleteGroup = ko.observable();
        this.isCreatePoolWizardVisible = ko.observable(false);
    }

    orderBy(colName) {
        redirectTo(undefined, undefined, {
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1
        });
    }

    orderClassFor(colName) {
        return `sortable ${
            this.sortedBy() === colName ? (this.order() === 1 ? 'des' : 'asc') : ''
        }`;
    }

    showCreatePoolWizard() {
        this.isCreatePoolWizardVisible(true);
    }

    hideCreatePoolWizard() {
        this.isCreatePoolWizardVisible(false);
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};
