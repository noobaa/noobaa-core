import ko from 'knockout';
import { isObject, isString } from 'utils';

const delay = 350;

const alignMapping = Object.freeze({
    left: 0,
    center: .5,
    right: 1
});

function normalizeParams(params) {
    let alignments = Object.keys(alignMapping);

    return ko.computed(
        () => {
            let naked = ko.unwrap(params);
            if (isObject(naked) && !isString(naked)) {
                let align = ko.unwrap(naked.align);

                return {
                    text: ko.unwrap(naked.text),
                    align: alignments.indexOf(align) > -1 ? align : 'center'
                };

            } else {

                return {
                    text: naked && naked.toString(),
                    align: 'center'
                };
            }
        }
    );
}

function position(tooltip, target, align) {
    let { left, top } = target.getBoundingClientRect();
    top += target.offsetHeight;
    left += target.offsetWidth / 2 - tooltip.offsetWidth * alignMapping[align];

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
                        if (params().text) {
                            tooltip.innerHTML = params().text;
                            tooltip.className = `tooltip ${params().align}`;
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
