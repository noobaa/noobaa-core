import template from './bucket-objects-table.html';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { throttle, makeArray } from 'utils';
import ObjectRowViewModel from './object-row';
import { redirectTo } from 'actions';

class BucketObjectsTableViewModel {
    constructor({ objects }) {
        this.pageSize = paginationPageSize;
        this.count = objects.count;
        this.sortedBy = objects.sortedBy;
        this.order = objects.order;
        
        this.page = ko.pureComputed({
            read: objects.page,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: objects.filter,
            write: throttle(phrase => this.filterObjects(phrase), 750)
        });

        this.rows = makeArray(
            this.pageSize,
            i => new ObjectRowViewModel(
                () => objects()[i]
            )
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
    viewModel: BucketObjectsTableViewModel,
    template: template,
}