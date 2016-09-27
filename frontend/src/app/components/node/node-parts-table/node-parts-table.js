import template from './node-parts-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';
import PartRowViewModel from './part-row';
import { paginationPageSize } from 'config';
import { redirectTo } from 'actions';
import { routeContext } from 'model';

const columns = deepFreeze([
    {
        name: 'state',
        cellTemplate: 'icon'
    },
    {
        name: 'object',
        label: 'file name',
        cellTemplate: 'link'
    },
    'bucket',
    'startOffset',
    'endOffset',
    {
        name: 'size',
        label: 'Part Size'
    }
]);

class NodePartsViewModel extends Disposable {
    constructor({ partList }) {
        super();

        this.pageSize = paginationPageSize;
        this.columns = columns;

        this.parts = ko.pureComputed(
            () => partList() && partList().parts
        );

        this.count = ko.pureComputed(
            () => partList() && partList().total_count
        );

        this.page = ko.pureComputed({
            read: () => Number(routeContext().query.page) || 0,
            write: page => redirectTo(undefined, undefined, { page })
        });
    }

    makePartRow(part) {
        return new PartRowViewModel(part);
    }
}

export default {
    viewModel: NodePartsViewModel,
    template: template
};
