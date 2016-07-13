import template from './object-parts-list.html';
import ObjectPartRowViewModel from './object-part-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { redirectTo } from 'actions';

class ObjectPartsListViewModel extends Disposable {
    constructor({ parts }) {
        super();

        this.pageSize = paginationPageSize;
        this.count = parts.count;

        this.page = ko.pureComputed({
            read: parts.page,
            write: page => redirectTo(undefined, undefined, { page })
        });

        this.rows = parts.map(
            (part, i) => {
                let partNumber = this.page() * this.pageSize + i();
                return new ObjectPartRowViewModel(part, partNumber, this.count());
            }
        );
    }
}

export default {
    viewModel: ObjectPartsListViewModel,
    template: template
};
