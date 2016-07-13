import template from './paginator.html';
import Disposable from 'disposable';
import ko from 'knockout';

class PaginatorViewModel extends Disposable {
    constructor({ itemCount, pageSize, page }) {
        super();

        this.page = page;

        this.count = ko.pureComputed(
            () => ko.unwrap(itemCount)
        );

        this.noResults = ko.pureComputed(
            () => this.count() === 0
        );

        this.pageStart = ko.pureComputed(
            () => this.page() * pageSize + 1
        );

        this.pageEnd = ko.pureComputed(
            () => Math.min(this.pageStart() + pageSize - 1, this.count())
        );

        this.isFirstPage = ko.pureComputed(
            () => this.page() === 0
        );

        this.isLastPage = ko.pureComputed(
            () => (this.page() + 1) * pageSize >= this.count()
        );
    }

    pageForward() {
        if (!this.isLastPage()) {
            this.page(this.page() + 1);
        }
    }

    pageBackward() {
        if (!this.isFirstPage()) {
            this.page(this.page() - 1);
        }
    }
}

export default {
    viewModel: PaginatorViewModel,
    template: template
};
