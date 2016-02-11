import template from './pool-nodes-table.html';
import NodeRowViewModel from './node-row';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { makeArray, throttle} from 'utils';
import { redirectTo } from 'actions';

class PoolNodesTableViewModel {
    constructor({ nodes }) {
        this.pageSize = paginationPageSize;
        this.count = nodes.count;
        this.sortedBy = nodes.sortedBy;
        this.order = nodes.order;

        this.page = ko.pureComputed({
            read: nodes.page,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: nodes.filter,
            write: throttle(phrase => this.filterObjects(phrase), 750)
        });

        this.rows = makeArray(
            this.pageSize,
            i => new NodeRowViewModel(() => nodes()[i])
        );

        this.hasNodes = ko.pureComputed(
            () => nodes().length > 0
        );        
    }

    pageTo(page) {
        redirectTo(undefined, {
            filter: this.filter(),
            sortBy: this.sortedBy(),
            order: this.order(),
            page: page
        });
    }

    filterObjects(phrase) {
        redirectTo(undefined, {
            filter: phrase || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: 0
        });
    }    

    orderBy(colName) {
        redirectTo(undefined, {
            filter: this.filter(),
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1,
            page: 0
        });
    }

    orderClassFor(colName) {
        if (this.sortedBy() === colName) {
            return this.order() === 1 ? 'des' : 'asc';
        } 
    }        
}

export default {
    viewModel: PoolNodesTableViewModel,
    template: template,
}