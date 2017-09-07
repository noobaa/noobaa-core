/* Copyright (C) 2016 NooBaa */

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

        this.rangeText = ko.pureComputed(
            () => {
                const count = this.count() || 0;
                const start = count !== 0 ? (this.page() || 0) * pageSize + 1 : 0;
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

    onPageForward() {
        if (!this.isLastPage()) {
            this.page(this.page() + 1);
        }
    }

    onPageBackward() {
        if (!this.isFirstPage()) {
            this.page(this.page() - 1);
        }
    }
}

export default {
    viewModel: PaginatorViewModel,
    template: template
};
