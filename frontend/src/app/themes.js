import { keyBy, deepFreeze, mapValues } from 'utils/core-utils';
import { themes } from 'config';

function _readThemeFromStyleSheet(className) {
    const { style } = Array.from(document.styleSheets[0].cssRules)
        .find(rule => rule.selectorText === `.${className}`);

    const propNames = Array.from(style)
        .filter(name => name.startsWith('--'));

    return deepFreeze(keyBy(
        propNames,
        (name) => name.substr(2),
        name => {
            const val = style.getPropertyValue(name)
                .split(',')
                .map(c => c.trim());

            return (
                (val.length === 3 && `rgb(${val.join()})`) ||
                (val.length === 4 && `rgba(${val.join()})`) ||
                'rgba(0,0,0,0)'
            );
        }
    ));
}

function getThemes(themes) {
    // Creating an object with getters in order to delay the resolution of
    // the theme class. This is needed becasue the config file (which define the mapping
    // between a theme name and the underlaying theme class) may cahnge during the
    // loading pashe of the application via the conifg patch mechanism.
    // In order to mitigate the cost of the style access process we save a cashe
    // keyd by the actual class name and not the theme name.
    const casheByClassName = new Map();
    return Object.defineProperties(
        {},
        mapValues(themes, (_, themeName) => ({
            enumerable: true,
            get: () => {
                const className = themes[themeName];
                let theme = casheByClassName.get(className);
                if (!theme) {
                    casheByClassName.set(
                        className,
                        theme = _readThemeFromStyleSheet(className)
                    );
                }
                return theme;
            }
        }))
    );
}

export default getThemes(themes);
