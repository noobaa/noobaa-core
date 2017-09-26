/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isDefined, isObject, isString, deepFreeze } from 'utils/core-utils';

const tooltip = document.createElement('p');
const delay = 350;

const positions = deepFreeze({
    above: 0,
    after: 1,
    below: 2,
    before: 3
});

const alignments = deepFreeze({
    start: 0,
    center: .5,
    end: 1
});

function toHtmlList(arr) {
    return `<ul class="bullet-list">${
        arr.map(
            item => `<li>${item}</li>`
        ).join('')
    }</ul>`;
}

function normalizeValue(value) {
    if (isString(value)) {
        return {
            text: value,
            position: 'below',
            align: 'center',
            breakWords: false
        };

    } else if (Array.isArray(value)) {
        const list = value.filter(isDefined);
        const text = list.length > 0 ?
            (list.length === 1 ? list[0] : toHtmlList(list)) :
            '';

        return {
            text: text,
            position: 'below',
            align: 'center',
            breakWords: false
        };

    } else if (isObject(value)) {
        let { text, position, align } = value;
        if (Array.isArray(text)) {
            const list = text.filter(isDefined);
            text = list.length > 0 ?
                (list.length > 1 ? toHtmlList(list) :  list[0]) :
                '';

        } else if (isObject(text)) {
            const { title  = '', list = [] } = text;
            text = `<p>${
                title
            }:</p>${
                toHtmlList(list.filter(isDefined))
            }`;
        }

        if (!Object.keys(positions).includes(position)) {
            position = 'below';
        }

        if (!Object.keys(alignments).includes(align)) {
            align = 'center';
        }

        return {
            text: text,
            position: position,
            align: align,
            breakWords: Boolean(value.breakWords)
        };

    } else {
        return {};
    }
}

function showTooltip(target, { text, align, position, breakWords }) {
    tooltip.innerHTML = text;
    tooltip.className = `tooltip ${align} ${position} ${breakWords ? 'break-words' : ''}`;
    document.body.appendChild(tooltip);

    const alignFactor = alignments[align];
    let { left, top, bottom, right } = target.getBoundingClientRect();

    switch (positions[position]) {
        case positions.above:
            top -= tooltip.offsetHeight;
            left += target.offsetWidth / 2 - tooltip.offsetWidth * alignFactor;
            break;

        case positions.after:
            top += target.offsetHeight / 2 - tooltip.offsetHeight * alignFactor;
            left = right;
            break;

        case positions.below:
            left += target.offsetWidth / 2 - tooltip.offsetWidth * alignFactor;
            top = bottom;
            break;

        case positions.before:
            top += target.offsetHeight / 2 - tooltip.offsetHeight * alignFactor;
            left -= tooltip.offsetWidth;
            break;
    }

    tooltip.style.top = `${Math.ceil(top)}px`;
    tooltip.style.left = `${Math.ceil(left)}px`;
}

function hideTooltip() {
    if (tooltip.parentElement) {
        document.body.removeChild(tooltip);
        tooltip.innerHTML = '';
    }
}

export default {
    init: function(target, valueAccessor) {
        const params = ko.pureComputed(
            () => normalizeValue(ko.deepUnwrap(valueAccessor()))
        );

        const hover = ko.observable(false);
        const paramsSub = params.subscribe(
            params => hover() && (
                params.text ? showTooltip(target, params) : hideTooltip()
            )
        );

        const hoverSub = hover
            .extend({
                rateLimit: {
                    timeout: delay,
                    method: 'notifyWhenChangesStop'
                }
            })
            .subscribe(
                hoverd => (hoverd && params().text) ?
                    showTooltip(target, params()) :
                    hideTooltip()
            );

        // Handle delyed hover state.
        ko.utils.registerEventHandler(target, 'mouseenter', () => hover(true));
        ko.utils.registerEventHandler(target, 'mouseleave', () => hover(false));

        // Cleanup code.
        ko.utils.domNodeDisposal.addDisposeCallback(
            target,
            () => {
                hideTooltip(tooltip);
                paramsSub.dispose();
                hoverSub.dispose();
            }
        );
    }
};
