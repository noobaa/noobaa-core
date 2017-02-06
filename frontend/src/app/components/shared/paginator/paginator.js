import template from './paginator.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';

class PaginatorViewModel extends BaseViewModel {
    constructor({ itemCount, pageSize, page }) {
        super();

        this.page = page;

        this.count = ko.pureComputed(
            () => ko.unwrap(itemCount)
        );

        this.noResults = ko.pureComputed(
            () => this.count() === 0
        );

        this.rangeText = ko.pureComputed(
            () => {
                const count = this.count() || 0;
                const start = (this.page() || 0) * pageSize + 1;
                const end = Math.min(start + pageSize - 1, count);
                return `${start} - ${end} of ${count}`;
            }
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
