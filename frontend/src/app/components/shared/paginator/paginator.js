import template from './paginator.html';
import ko from 'knockout';

class PaginatorViewModel {
    constructor({ itemCount, pageSize, page }) {
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

        this.icon = `/fe/assets/icons.svg#chevron`;
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
}