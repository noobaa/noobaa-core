import template from './node-parts-table.html';
import ko from 'knockout';
import { makeArray } from 'utils';
import PartRowViewModel from './part-row';
import { paginationPageSize } from 'config';
import { redirectTo } from 'actions';

class NodePartsViewModel {
    constructor({ parts }) {
        this.pageSize = paginationPageSize;
        this.count = parts.count;

        this.page = ko.pureComputed({
            read: parts.page,
            write: page => redirectTo(undefined, { page })
        });

        this.rows = makeArray(
            this.pageSize,
            i => new PartRowViewModel(() => parts()[i])
        );

        this.hasParts = ko.pureComputed(
            () => parts().length > 0
        );
    }
}

export default {
    viewModel: NodePartsViewModel,
    template: template
};
