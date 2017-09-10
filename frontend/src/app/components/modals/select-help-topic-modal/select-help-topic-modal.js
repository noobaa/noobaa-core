/* Copyright (C) 2017 NooBaa */

import template from './select-help-topic-modal.html';
import Observer from 'observer';
import TopicRowViewModel from './topic-row';
import FormViewModel from 'components/form-view-model';
import { createCompareFunc } from 'utils/core-utils';
import { inputThrottle } from 'config';
import ko from 'knockout';
import { action$, state$ } from 'state';
import { ensureHelpMeta } from 'action-creators';
import externalDataStore from '../../../services/external-data-store';
import { support } from 'config';

const formName = 'selectHelpTopic';

function _searchByKeywords(topics, categories, search = '', selectedCategory) {
    let result = topics;
    const compareTopicsOp = createCompareFunc(topic => {
        const scoreString = topic.score.toString();
        const score = ('00000000'+ scoreString).slice(-scoreString.length);
        return `${score}_${topic.categoryOrder}_${topic.title.replace(/ /g, '_')}`;
    }, 1);

    if(selectedCategory && selectedCategory.order) {
        result = topics.filter(topic => topic.category === selectedCategory.label);
    }

    const searchWords = new Set(search
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    );

    result = result
        .map(topic => ({ ...topic, score: _scoreTopic(topic, searchWords) }))
        .filter(topic => topic.score > 0);

    return result.sort(compareTopicsOp);
}

function _scoreTopic(topic, searchWords) {
    if(searchWords.size) {
        let score = 0;

        Array.from(searchWords).forEach((searchWord, index) => {
            if(topic.keywords.some(keyword => keyword.includes(searchWord))) {
                score += searchWords.size * 2 + searchWords.size - index + 1;
            }
        });

        return Math.pow(searchWords.size * 3 + 1, 2) - score;
    } else {
        // default score value
        return 1;
    }
}

class SelectHelpTopicModalViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.categories = ko.observable();
        this.topics =  ko.observable();
        this.deskUri = support.helpDesk;
        this.user = ko.observable();
        this.rows = ko.observableArray();
        this.isNoResults = ko.observable();
        this.isFormInitialized = ko.observable();
        this.form = null;

        this.observe(
            state$.getMany(
                ['session', 'user'],
                ['forms', formName, 'fields'],
                ['helpMetadata', 'metadataLoaded']
            ),
            this.onState
        );

        action$.onNext(ensureHelpMeta());
    }

    onState([user, formFields, metadataLoaded]) {
        if(!metadataLoaded) {
            this.isFormInitialized(false);
            return;
        }

        if (!this.form) {
            const interactiveHelp = externalDataStore.get('interactiveHelp');
            const compareCategoriesOp = createCompareFunc(category => category.order, 1);
            const categories = interactiveHelp.categories
                .sort(compareCategoriesOp)
                .map(category => ({ label: category.label, value: category }));

            const topics = interactiveHelp.topics.map(topic => {
                const {value: category} = categories
                    .find(category => category.label.toLowerCase() === topic.category.toLowerCase());

                return {...topic, categoryOrder: category.order};
            });

            this.categories(categories);
            this.topics(topics);
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    search: '',
                    selectedCategory: this.categories()[0].value
                }
            });

            // Throttle the input on the search
            this.throttledSearch = this.form.search
                .throttle(inputThrottle);
            this.isFormInitialized(true);
        }

        if (formFields) {
            const { search, selectedCategory } = formFields;

            const rows = _searchByKeywords(this.topics(), this.categories(), search.value, selectedCategory.value)
                .map((topic, i) => {
                    const row = this.rows.get(i) || new TopicRowViewModel();
                    row.onTopic(topic);
                    return row;
                });

            this.rows(rows);
            this.isNoResults(Boolean(!rows.length));
        }

        this.user(user);
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: SelectHelpTopicModalViewModel,
    template: template
};
