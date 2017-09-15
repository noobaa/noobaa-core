/* Copyright (C) 2017 NooBaa */

import template from './select-help-topic-modal.html';
import Observer from 'observer';
import TopicRowViewModel from './topic-row';
import FormViewModel from 'components/form-view-model';
import { createCompareFunc } from 'utils/core-utils';
import { inputThrottle, support } from 'config';
import ko from 'knockout';
import { action$, state$ } from 'state';
import { ensureHelpMetadata } from 'action-creators';
import externalDataStore from '../../../services/external-data-store';

const helpMetadata = 'helpMetadata';
const formName = 'selectHelpTopic';
const allTopics = { label: 'All Topics', order: 0 };

function _filterByKeywords(topics, categories, filter = '', selectedCategory) {
    const filterWords = new Set(filter
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    );
    const compareTopicsOp = createCompareFunc(topic => topic.score, filterWords.size ? -1 : 1);
    const filteredBycategory = selectedCategory && selectedCategory.order ?
        topics.filter(topic => categories[topic.category] === selectedCategory) :
        topics;

    return filteredBycategory
        .map(topic => ({ ...topic, score: _scoreTopic(topic, categories[topic.category], filterWords) }))
        .filter(topic => topic.score)
        .sort(compareTopicsOp);
}

function _scoreTopic(topic, category, filterWords) {
    if(filterWords.size) {
        let score = 0;

        Array.from(filterWords).forEach((filterWord, index) => {
            if(topic.keywords.some(keyword => keyword === filterWord)) {
                score += filterWords.size * 2 + filterWords.size - index + 1;
            } else if (topic.keywords.some(keyword => keyword.includes(filterWord))) {
                score += filterWords.size + filterWords.size - index + 1;
            }
        });

        return score;
    } else {
        return `${category.order}_${topic.title.replace(/ +/, '_')}`;
    }
}

class SelectHelpTopicModalViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.categoryOptions = ko.observable();
        this.deskUrl = support.helpDesk;
        this.user = ko.observable();
        this.rows = ko.observableArray();
        this.hasNoResults = ko.observable();
        this.isFormInitialized = ko.observable();
        this.form = null;

        this.observe(
            state$.getMany(
                ['interactiveHelp', 'metadataLoaded'],
                ['session', 'user'],
                ['forms', formName, 'fields'],
            ),
            this.onInteractiveHelp
        );
    }

    onInteractiveHelp([metadataLoaded, user, formFields]) {
        if(!metadataLoaded) {
            this.isFormInitialized(false);
            action$.onNext(ensureHelpMetadata());
            return;
        }

        const interactiveHelp = externalDataStore.get(helpMetadata);
        const { filter = '', selectedCategory = allTopics } = formFields || {};
        const compareCategoriesOp = createCompareFunc(category => category.order, 1);
        const topicsList = Object.values(interactiveHelp.topics);
        const categories = { allTopics, ...interactiveHelp.categories };
        const categoryList = Object.values(categories)
            .sort(compareCategoriesOp)
            .map(category => ({ label: category.label, value: category }));
        const rows = _filterByKeywords(topicsList, categories, filter.value, selectedCategory.value)
            .map((topic, i) => {
                const row = this.rows.get(i) || new TopicRowViewModel();
                row.onTopic(topic);
                return row;
            });

        this.categoryOptions(categoryList);
        this.user(user);
        this.rows(rows);
        this.hasNoResults(!rows.length);

        if (!formFields) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    filter: '',
                    selectedCategory: categoryList[0].value
                }
            });

            // Throttle the input on the filter
            this.throttledFilter = this.form.filter
                .throttle(inputThrottle);
            this.isFormInitialized(true);
        }
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
