import ko from 'knockout';
import { isObject, isString } from 'utils';

const delay = 350;

const alignments = Object.freeze({
    left: 0,
    center: .5,
    right: 1
});

function toHtmlList(arr) {
    return `<ul>${
        arr.map(
            item => `<li>${item}</li>`
        ).join('')
    }</ul>`;
}

function normalizeParams(params) {
    return ko.computed(
        () => {
            let naked = ko.unwrap(params);
            if (isString(naked)) {
                return {
                    text: naked,
                    css: 'center',
                    align: alignments.center
                };

            } else if (naked instanceof Array) {
                return {
                    text: naked.length === 1 ? naked : toHtmlList(naked),
                    css: 'center',
                    align: alignments.center
                };

            } else if (isObject(naked)) {
                let text = ko.unwrap(naked.text);
                if (text instanceof Array) {
                    text = naked.length === 1 ? naked : toHtmlList(naked);
                }

                let pos = ko.unwrap(naked.align);
                if (!Object.keys(alignments).includes(pos)) {
                    pos = 'center';
                }

                return {
                    text: text,
                    css: pos,
                    align: alignments[pos]
                };

            }
        }
    );
}

function position(tooltip, target, align) {
    let { left, top } = target.getBoundingClientRect();
    top += target.offsetHeight;
    left += target.offsetWidth / 2 - tooltip.offsetWidth * align;

    tooltip.style.top = `${Math.ceil(top)}px`;
    tooltip.style.left = `${Math.ceil(left)}px`;
}

export default {
    init: function(target, valueAccessor) {
        let params = normalizeParams(valueAccessor());
        let handle = -1;
        let tooltip = document.createElement('p');

        ko.utils.registerEventHandler(
            target,
            'mouseenter',
            () => {
                handle = setTimeout(
                    () => {
                        handle = -1;
                        if (params() && params().text) {
                            tooltip.innerHTML = params().text;
                            tooltip.className = `tooltip ${params().css}`;
                            document.body.appendChild(tooltip);
                            position(tooltip, target, params().align);
                        }
                    },
                    delay
                );
            }
        );

        ko.utils.registerEventHandler(
            target,
            'mouseleave',
            () => handle > -1 ?
                clearTimeout(handle) :
                tooltip.parentElement && document.body.removeChild(tooltip)
        );

        ko.utils.domNodeDisposal.addDisposeCallback(
            target,
            () => {
                clearTimeout(handle);
                tooltip.parentElement && document.body.removeChild(tooltip);
                params.dispose();
            }
        );
    }
};
