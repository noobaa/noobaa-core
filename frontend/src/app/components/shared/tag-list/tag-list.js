/* Copyright (C) 2016 NooBaa */

import template from './tag-list.html';
import ko from 'knockout';
import numeral from 'numeral';
import { isObject } from 'utils/core-utils';

function _normalizeTooltip(tooltip) {
    if (isObject(tooltip)) {
        return {
            ...tooltip,
            breakWords: true
        };
    } else {
        return {
            text: tooltip,
            breakWords: true
        };
    }

}

function _mapParamsToProps(params) {
    const {
        tags: allTags = [],
        maxCount = Infinity,
        separator = ''
    } = params;

    const hasTooMany = allTags.length > maxCount;
    const tags = allTags
        .slice(0, hasTooMany ? maxCount - 1: allTags.length)
        .map((tag, i) => ({
            text: tag.text || tag,
            css: {
                'push-prev-half': Boolean(i),
                [tag.css || '']: Boolean(tag.css)
            },
            tooltip: tag.tooltip &&
                _normalizeTooltip(tag.tooltip)
        }));

    let extra = null;
    if (hasTooMany) {
        const extraTags = allTags.slice(maxCount - 1);
        extra = {
            text: `${numeral(extraTags.length).format(',')} more`,
            tooltip: {
                text: extraTags,
                template: 'list',
                align: 'end',
                breakWords: true
            }
        };
    }

    return { tags, extra, separator };
}

class TagListViewModel  {
    tags = ko.observableArray();
    separator = ko.observable();
    extra = ko.observable();

    constructor(params) {
        this.sub = ko.computed(() => {
            const unwraped = ko.deepUnwrap(params);
            const props = _mapParamsToProps(unwraped);
            ko.assignToProps(this, props);
        });
    }

    dispose() {
        this.sub.dispose();
    }
}

export default {
    viewModel: TagListViewModel,
    template: template
};
