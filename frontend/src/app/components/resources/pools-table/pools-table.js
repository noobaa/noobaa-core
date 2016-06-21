import template from './pools-table.html';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { makeArray, cmpBools, cmpStrings, cmpInts } from 'utils';
import { redirectTo } from 'actions';
import { routeContext, systemInfo } from 'model';

const maxRows = 100;

const poolCmpFuncs = Object.freeze({
    state: () => cmpBools(true, true),
    name: (p1, p2) => cmpStrings(p1.name, p2.name),
    nodecount: (p1, p2) => cmpInts(p1.nodes.count, p2.nodes.count),
    onlinecount: (p1, p2) => cmpInts(p1.nodes.online, p2.nodes.online),
    offlinecount: (p1, p2) => cmpInts(
        p1.nodes.count - p1.nodes.online,
        p2.nodes.count - p2.nodes.online
    ),
    usage: (p1, p2) => cmpInts(p1.storage.used, p2.storage.used),
    capacity: (p1, p2) => cmpInts(p1.storage.total, p2.storage.total)
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
            () => (systemInfo() ? systemInfo().pools.slice(0) : []).sort(
                (b1, b2) => this.order() * poolCmpFuncs[this.sortedBy()](b1, b2)
            )
        );

        let rows = makeArray(
            maxRows,
            i => new PoolRowViewModel(() => pools()[i])
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
        if (this.sortedBy() === colName) {
            return this.order() === 1 ? 'des' : 'asc' ;
        }
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
