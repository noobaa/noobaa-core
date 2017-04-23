/* Copyright (C) 2016 NooBaa */

import mainLayoutReducer from './main-layout-reducer';
// import loginLayoutReducer from './login-layout-reducer';
// import { deepFreeze, noop } from 'utils/core-utils';

// const layoutReducerMapping = deepFreeze({
//     main: mainLayoutReducer,
//     login: loginLayoutReducer
// });

export default mainLayoutReducer;

// export default function(state = {}, action) {
//     const { layout } = state;
//     let reducerName = layout && layout.name;

//     switch(action.type) {
//         case 'SESSION_RESTORED':
//             reducerName = action.passwordExpired ? 'login' : 'main';
//             break;

//         case 'SIGNED_IN':
//             reducerName = 'main';
//             break;

//         case 'RESOTREING_SESSION_FAILED':
//         case 'SIGN_OUT':
//             reducerName = 'login';
//             break;
//     }

//     const reducer = layoutReducerMapping[reducerName] || noop;
//     return reducer(state, action);
// }
